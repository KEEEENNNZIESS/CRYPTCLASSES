'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateAnswer } = require('../lib/answer-validation');

const choiceOptions = ['o1','o2','o3','o4','o5'].map((id)=>({id,text:id}));

test('single and multi answers only accept known unique option ids', () => {
  assert.equal(validateAnswer('single', choiceOptions, 'o2').valid, true);
  assert.equal(validateAnswer('single', choiceOptions, 'o9').valid, false);
  assert.equal(validateAnswer('multi', choiceOptions, ['o1','o4']).valid, true);
  assert.equal(validateAnswer('multi', choiceOptions, ['o1','o1']).valid, false);
  assert.equal(validateAnswer('multi', choiceOptions, ['o9']).valid, false);
});

test('true/false booleans and blank values are handled correctly', () => {
  assert.equal(validateAnswer('truefalse', [], false).valid, true);
  assert.equal(validateAnswer('truefalse', [], '').valid, true);
  assert.equal(validateAnswer('truefalse', [], 'false').valid, false);
});

test('matching answer cannot reuse a right-side item', () => {
  const options = { left:[{id:'l1'},{id:'l2'}], right:[{id:'r1'},{id:'r2'}] };
  assert.equal(validateAnswer('matching', options, {l1:'r2'}).valid, true);
  assert.equal(validateAnswer('matching', options, {l1:'r2',l2:'r2'}).valid, false);
  assert.equal(validateAnswer('matching', options, {}).valid, true);
});

test('ordering answer permits partial progress but rejects duplicate/unknown ids', () => {
  const options = { items:[{id:'i1'},{id:'i2'},{id:'i3'}] };
  assert.equal(validateAnswer('ordering', options, ['i2']).valid, true);
  assert.equal(validateAnswer('ordering', options, ['i2','i2']).valid, false);
  assert.equal(validateAnswer('ordering', options, ['i4']).valid, false);
});
