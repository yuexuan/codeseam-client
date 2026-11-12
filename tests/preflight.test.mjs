import test from 'node:test';
import assert from 'node:assert/strict';
import { summarize } from '../src/features/preflight/model.ts';
test('unknown and optional do not become required work or block by status alone',()=>{
 const fact=(status,blocking=false)=>({id:status,group:'system',label:status,value:'observed',status,detail:'evidence',source:'fixture',blocking});
 const result=summarize({observedAt:'1',checks:[fact('pending'),fact('unknown'),fact('optional'),fact('unsupported'),fact('satisfied')]});
 assert.equal(result.pending,1);assert.equal(result.unknown,1);assert.equal(result.optional,1);assert.deepEqual(result.blockers,[]);
 const blocked=summarize({observedAt:'1',checks:[fact('unsupported',true)]});assert.equal(blocked.blockers.length,1);
});
