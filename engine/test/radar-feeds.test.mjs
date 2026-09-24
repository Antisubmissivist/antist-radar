import test from 'node:test';
import assert from 'node:assert/strict';
import {parseFeed,arcticShift,usableEvidence} from '../apis/sources/radar-feeds.mjs';
test('RDF and empty feed are distinguishable from HTML errors',()=>{
  const d=parseFeed('<rdf:RDF xmlns:rdf="urn:rdf" xmlns:dc="urn:dc"><item><title>Notice</title><link>https://example.org/n</link><dc:date>2026-09-11T00:00:00Z</dc:date><description>Details</description></item></rdf:RDF>');
  assert.equal(d.length,1);assert.equal(d[0].publishedAt,'2026-09-11T00:00:00.000Z');
  assert.deepEqual(parseFeed('<rss><channel><title>Feed</title></channel></rss>'),[]);
  assert.throws(()=>parseFeed('<html>Access denied</html>'));
});

// Reddit runs through the Arctic Shift archive, which answers `{data:[…]}`.
const AS_POST = {
  id:'abc123', permalink:'/r/artificial/comments/abc123/hello/',
  title:'A new open-weights model lands &amp; it is fast',
  selftext:'',
  created_utc:1790254600, author:'someone', score:1, num_comments:0,
  url:'https://example.com/open-weights',   // a link post: the article is the content
  over_18:false, stickied:false, link_flair_text:'News',
};
function withFetch(handler){const o=globalThis.fetch;globalThis.fetch=handler;return()=>{globalThis.fetch=o;};}

test('Arctic Shift: turns Reddit posts into linkable events with real evidence',async()=>{
  const restore=withFetch(async url=>{
    assert.match(String(url),/arctic-shift\.photon-reddit\.com\/api\/posts\/search/);
    if(String(url).includes('subreddit=artificial'))return new Response(JSON.stringify({data:[
      AS_POST,
      {...AS_POST,id:'nsfw1',permalink:'/r/x/nsfw1/',over_18:true},
      {...AS_POST,id:'pin1',permalink:'/r/x/pin1/',stickied:true},
    ]}),{status:200});
    return new Response(JSON.stringify({data:[]}),{status:200});
  });
  try{
    const r=await arcticShift();
    // over_18 and stickied are dropped, not published.
    assert.equal(r.items.length,1);
    const e=r.items[0];
    assert.equal(e.source,'Reddit');
    assert.equal(e.category,'ai');
    assert.equal(e.url,'https://www.reddit.com/r/artificial/comments/abc123/hello/');
    assert.equal(e.title,'A new open-weights model lands & it is fast');
    assert.equal(e.publishedAt,new Date(1790254600*1000).toISOString());
    // The evidence gate is what drops bare headlines; a Reddit card must pass it.
    assert.ok(usableEvidence(e.evidence,e.title),'evidence must survive the bare-headline gate');
    assert.ok(e.evidence.includes('r/artificial'));
    assert.ok(e.evidence.includes('Linked: https://example.com/open-weights'));
    assert.ok(!e.evidence.includes('[object Object]'));
  }finally{restore();}
});

test('Arctic Shift: keeps articles and real discussions, drops memes and one-liners',async()=>{
  const restore=withFetch(async url=>{
    if(String(url).includes('subreddit=japanlife'))return new Response(JSON.stringify({data:[
      // substantial discussion — kept
      {...AS_POST,id:'disc',url:'https://www.reddit.com/r/japanlife/comments/disc/x/',selftext:'A'.repeat(220)},
      // one-line personal post — dropped
      {...AS_POST,id:'short',url:'https://www.reddit.com/r/japanlife/comments/short/x/',selftext:'Visa renewal anxiety'},
      // removed body — dropped
      {...AS_POST,id:'gone',url:'https://www.reddit.com/r/japanlife/comments/gone/x/',selftext:'[removed]'},
      // meme image link — dropped
      {...AS_POST,id:'meme',url:'https://i.redd.it/abc.jpeg'},
      // survey/spam link — dropped
      {...AS_POST,id:'spam',url:'https://docs.google.com/forms/d/xyz/viewform'},
      // crosspost to another sub (relative url) — dropped
      {...AS_POST,id:'cross',url:'/r/other/comments/cross/x/',selftext:'short'},
    ]}),{status:200});
    return new Response(JSON.stringify({data:[]}),{status:200});
  });
  try{
    const r=await arcticShift();
    assert.equal(r.items.length,1);
    assert.equal(r.items[0].category,'japan-life');
  }finally{restore();}
});

test('Arctic Shift: a total outage throws (red), it does not read as a quiet day',async()=>{
  const restore=withFetch(async()=>new Response('rate limited',{status:429}));
  try{await assert.rejects(()=>arcticShift(),/Arctic Shift unavailable/);}
  finally{restore();}
});

test('Arctic Shift: one subreddit failing still returns the others',async()=>{
  const restore=withFetch(async url=>{
    if(String(url).includes('subreddit=stocks'))return new Response('nope',{status:429});
    if(String(url).includes('subreddit=worldnews'))return new Response(JSON.stringify({data:[AS_POST]}),{status:200});
    return new Response(JSON.stringify({data:[]}),{status:200});
  });
  try{
    const r=await arcticShift();
    assert.equal(r.items.length,1);
    assert.equal(r.items[0].category,'geopolitics');
  }finally{restore();}
});
