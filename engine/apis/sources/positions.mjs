// Chain Position Layer — how close Antist's Byreal CLMM positions are to
// falling out of range. Feeds auto-crypto-trader-runner.
//
// Ranges are read live from byreal-cli, never hand-copied into .env: a
// concentrated-liquidity range is a fact on chain, and a transcribed copy of
// it goes stale the moment a position is rebalanced. Out of range means the
// position has stopped earning fees entirely — that is the whole point of
// watching it.
//
// Config (.env):
//   BYREAL_WALLET=<solana address>     # read-only, no key material
//   BYREAL_CLI=<path>                  # optional, if not on PATH
//   LP_WARN_PCT / LP_FLASH_PCT         # distance-to-edge thresholds
//
// Falls back to LP_POSITIONS="label:yahooSymbol:lower:upper,..." if the CLI
// is unavailable, so the layer degrades instead of vanishing.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { safeFetch } from '../utils/fetch.mjs';

const run = promisify(execFile);

const WARN_PCT = parseFloat(process.env.LP_WARN_PCT || '5');
const FLASH_PCT = parseFloat(process.env.LP_FLASH_PCT || '3');
const CLI_TIMEOUT = parseInt(process.env.BYREAL_TIMEOUT_MS || '25000', 10);

// Prefer the package's own .cjs entry over the .cmd shim: running it through
// `node` needs no shell, which sidesteps both Node's refusal to spawn .cmd
// (CVE-2024-27980) and the argument-escaping hazard of shell:true.
//
// The scoped package @byreal-io/byreal-cli is the live one (0.3.6). An older
// unscoped `byreal-cli` (0.2.8) may also be installed and does NOT support
// `--user`; resolving to it produces a confusing "unknown option" error, so
// the scoped path is tried first.
function findCli() {
  if (process.env.BYREAL_CLI && existsSync(process.env.BYREAL_CLI)) {
    return { bin: process.env.BYREAL_CLI, viaNode: /\.(c?js|mjs)$/i.test(process.env.BYREAL_CLI) };
  }
  const npmRoot = process.platform === 'win32'
    ? path.join(os.homedir(), 'AppData', 'Roaming', 'npm')
    : path.join(os.homedir(), '.npm-global', 'lib');

  const entries = [
    path.join(npmRoot, 'node_modules', '@byreal-io', 'byreal-cli', 'dist', 'index.cjs'),
    path.join(npmRoot, 'node_modules', 'byreal-cli', 'dist', 'index.cjs'),
  ];
  const entry = entries.find(existsSync);
  if (entry) return { bin: entry, viaNode: true };

  const shims = process.platform === 'win32'
    ? [path.join(npmRoot, 'byreal-cli.cmd')]
    : ['/usr/local/bin/byreal-cli', path.join(os.homedir(), '.npm-global', 'bin', 'byreal-cli')];
  const shim = shims.find(existsSync);
  return shim ? { bin: shim, viaNode: false } : null;
}

// Solana addresses are base58: no 0, O, I or l. Everything we hand to the
// shell is checked against this, because a .cmd shim forces shell:true
// (Node refuses to spawn .cmd directly since CVE-2024-27980) and shell:true
// is exactly where an unvalidated string becomes command injection.
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

// Allowed: flags (--user), subcommands/enum values (positions, list, json),
// plain integers (--status 0), and base58 addresses. Nothing else reaches
// the shell — no spaces, quotes, &, |, ; or backticks can survive this.
const SAFE_ARG = /^(--?[a-z][a-z-]*|[a-z][a-z-]*|[0-9]+)$/;

function assertSafe(arg) {
  const s = String(arg);
  if (SAFE_ARG.test(s) || BASE58.test(s)) return s;
  throw new Error(`拒绝把不安全的参数交给 shell: "${s.slice(0, 40)}"`);
}

async function cli(cliRef, args) {
  const full = [...args, '-o', 'json', '--non-interactive'].map(assertSafe);

  let cmd, argv, useShell = false;
  if (cliRef.viaNode) {
    cmd = process.execPath;            // run the .cjs with this same node
    argv = [cliRef.bin, ...full];
  } else {
    // .cmd / .bat shims are the fallback only; they force a shell on Windows.
    useShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(cliRef.bin);
    cmd = useShell ? `"${cliRef.bin}"` : cliRef.bin;
    argv = full;
  }

  const { stdout } = await run(cmd, argv, {
    timeout: CLI_TIMEOUT,
    maxBuffer: 8 * 1024 * 1024,
    windowsHide: true,
    shell: useShell,
  });
  // The CLI prints an ASCII banner before the JSON on some commands.
  const start = stdout.indexOf('{');
  if (start < 0) throw new Error(`byreal-cli returned no JSON: ${stdout.slice(0, 160)}`);
  const parsed = JSON.parse(stdout.slice(start));
  if (parsed.success === false) throw new Error(parsed.error || 'byreal-cli reported failure');
  return parsed;
}

const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
const r2 = n => (n == null ? null : Math.round(n * 100) / 100);
const money = n => (n == null ? '?' : Math.abs(n) >= 1000 ? Math.round(n).toLocaleString('en-US') : Number(n).toFixed(2));

function classify(inRange, nearestPct) {
  if (inRange === false) return 'out-of-range';
  if (nearestPct == null) return 'unknown';
  if (nearestPct <= FLASH_PCT) return 'flash';
  if (nearestPct <= WARN_PCT) return 'warn';
  return 'ok';
}

async function fromByreal(cliRef, wallet) {
  const listed = await cli(cliRef, ['positions', 'list', '--user', wallet, '--status', '0']);
  const raw = listed?.data?.positions || [];
  if (raw.length === 0) return { positions: [], note: '钱包下没有 active CLMM 仓位' };

  const rows = await Promise.all(raw.map(async p => {
    const base = {
      label: p.pair,
      nftMint: p.nftMintAddress,
      pool: p.poolAddress,
      liquidityUsd: num(p.liquidityUsd),
      earnedUsd: num(p.earnedUsd),
      pnlUsd: num(p.pnlUsd),
    };
    try {
      const a = await cli(cliRef, ['positions', 'analyze', p.nftMintAddress]);
      // The CLI nests the useful parts; tolerate either shape.
      const d = a.data?.position ? a.data : (a.data?.data || a.data || {});
      const pos = d.position || d;
      const rh = d.rangeHealth || {};
      const ctx = d.poolContext || {};
      const fees = d.unclaimedFees || {};

      const inRange = pos.inRange;
      const toLower = num(rh.distanceToLower);
      const toUpper = num(rh.distanceToUpper);
      const nearestPct = [toLower, toUpper].filter(v => v != null).length
        ? Math.min(...[toLower, toUpper].filter(v => v != null))
        : null;

      return {
        ...base,
        price: num(rh.currentPrice),
        range: { lower: num(pos.priceLower), upper: num(pos.priceUpper) },
        inRange,
        distToLowerPct: r2(toLower),
        distToUpperPct: r2(toUpper),
        nearestEdge: toLower != null && toUpper != null ? (toLower <= toUpper ? 'lower' : 'upper') : null,
        nearestPct: r2(nearestPct),
        // Out of range means this APR is being forfeited, not earned.
        feeApr24h: ctx.feeApr24h ?? null,
        unclaimedUsd: num(String(fees.totalUsd || '').replace('$', '')),
        cliRisk: rh.outOfRangeRisk ?? null,
        status: classify(inRange, nearestPct),
        source: 'byreal-cli',
      };
    } catch (e) {
      return { ...base, status: 'error', error: `analyze 失败: ${e.message}`, source: 'byreal-cli' };
    }
  }));

  return { positions: rows };
}

// --- fallback: manually configured ranges priced off Yahoo ---

async function fromEnv() {
  const raw = (process.env.LP_POSITIONS || '').trim();
  if (!raw) return { positions: [] };
  const BASE = 'https://query1.finance.yahoo.com/v8/finance/chart';
  const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' };

  const specs = raw.split(',').map(s => s.trim()).filter(Boolean).map(part => {
    const [label, symbol, lower, upper] = part.split(':');
    if (!label || !symbol || !Number.isFinite(+lower) || !Number.isFinite(+upper)) {
      return { label: label || part, configError: `无法解析区间定义: "${part}"` };
    }
    return { label, symbol, lower: +lower, upper: +upper };
  });

  const rows = await Promise.all(specs.map(async p => {
    if (p.configError) return { label: p.label, status: 'config-error', configError: p.configError, source: 'env' };
    try {
      const d = await safeFetch(`${BASE}/${encodeURIComponent(p.symbol)}?range=5d&interval=1d`, { timeout: 10000, headers: UA });
      const price = d?.chart?.result?.[0]?.meta?.regularMarketPrice;
      if (!Number.isFinite(price)) throw new Error(`no price for ${p.symbol}`);
      const inRange = price >= p.lower && price <= p.upper;
      const toLower = ((price - p.lower) / price) * 100;
      const toUpper = ((p.upper - price) / price) * 100;
      const nearestPct = Math.min(toLower, toUpper);
      return {
        label: p.label, price, range: { lower: p.lower, upper: p.upper }, inRange,
        distToLowerPct: r2(toLower), distToUpperPct: r2(toUpper),
        nearestEdge: toLower <= toUpper ? 'lower' : 'upper', nearestPct: r2(nearestPct),
        status: classify(inRange, nearestPct), source: 'env',
      };
    } catch (e) {
      return { label: p.label, status: 'error', error: e.message, source: 'env' };
    }
  }));
  return { positions: rows };
}

export async function briefing() { return collect(); }

export async function collect() {
  const wallet = (process.env.BYREAL_WALLET || '').trim();
  const cliRef = findCli();
  const notes = [];
  let result = { positions: [] };

  if (wallet && cliRef) {
    try {
      result = await fromByreal(cliRef, wallet);
    } catch (e) {
      notes.push(`byreal-cli 调用失败：${e.message}`);
      result = await fromEnv();
      if (result.positions.length) notes.push('已回退到 .env 手配区间（可能已过期）');
    }
  } else {
    if (!wallet) notes.push('未配置 BYREAL_WALLET');
    if (!cliRef) notes.push('未找到 byreal-cli（可用 BYREAL_CLI 指定路径）');
    result = await fromEnv();
  }

  const rows = result.positions;

  if (rows.length === 0) {
    return {
      configured: false,
      // Loud, not silent: "nothing wrong" and "nothing checked" must not look alike.
      note: result.note || `仓位层未监控任何东西 —— ${notes.join('；') || '无可用数据源'}`,
      notes, positions: [], alerts: [], actionable: false,
      timestamp: new Date().toISOString(),
    };
  }

  const alerts = [];
  for (const r of rows) {
    if (r.status === 'out-of-range') {
      alerts.push({
        severity: 'critical', label: r.label,
        // 有效数字，不是原始浮点：103.26934613 对任何人都没有多余信息
        message: `${r.label} 已脱离区间：现价 ${money(r.price)}，区间 ${money(r.range?.lower)}–${money(r.range?.upper)}`
          + `（停止收费${r.feeApr24h ? `，该池 24h 费率 APR ${r.feeApr24h}` : ''}）`,
      });
    } else if (r.status === 'flash') {
      alerts.push({ severity: 'high', label: r.label,
        message: `${r.label} 距${r.nearestEdge === 'lower' ? '下' : '上'}轨仅 ${r.nearestPct}%（FLASH 阈值 ${FLASH_PCT}%）` });
    } else if (r.status === 'warn') {
      alerts.push({ severity: 'medium', label: r.label,
        message: `${r.label} 距${r.nearestEdge === 'lower' ? '下' : '上'}轨 ${r.nearestPct}%（关注阈值 ${WARN_PCT}%）` });
    } else if (r.status === 'error' || r.status === 'config-error') {
      alerts.push({ severity: 'medium', label: r.label, message: r.error || r.configError });
    }
  }

  return {
    configured: true,
    dataSource: rows[0]?.source || 'unknown',
    thresholds: { warnPct: WARN_PCT, flashPct: FLASH_PCT },
    notes,
    positions: rows,
    alerts,
    actionable: alerts.length > 0,
    timestamp: new Date().toISOString(),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(await collect(), null, 2));
}
