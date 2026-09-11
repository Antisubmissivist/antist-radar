import test from 'node:test';
import assert from 'node:assert/strict';
import {parseFeed} from '../apis/sources/radar-feeds.mjs';
test('RDF and empty feed are distinguishable from HTML errors',()=>{
  const d=parseFeed('<rdf:RDF xmlns:rdf="urn:rdf" xmlns:dc="urn:dc"><item><title>Notice</title><link>https://example.org/n</link><dc:date>2026-09-11T00:00:00Z</dc:date><description>Details</description></item></rdf:RDF>');
  assert.equal(d.length,1);assert.equal(d[0].publishedAt,'2026-09-11T00:00:00.000Z');
  assert.deepEqual(parseFeed('<rss><channel><title>Feed</title></channel></rss>'),[]);
  assert.throws(()=>parseFeed('<html>Access denied</html>'));
});
