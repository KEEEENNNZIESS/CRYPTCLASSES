'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { gradeQuestion, blankAnswer } = require('../lib/grading');

test('single-choice: correct, wrong, and blank', () => {
  const q = { type:'single', answer_key:{correctId:'o3'} };
  assert.deepEqual(gradeQuestion(q,'o3'),{status:'correct',points:1});
  assert.deepEqual(gradeQuestion(q,'o2'),{status:'wrong',points:0});
  assert.deepEqual(gradeQuestion(q,undefined),{status:'blank',points:0});
  assert.deepEqual(gradeQuestion(q,undefined,true),{status:'unanswered',points:0});
});

test('multiple-select: partial credit and no penalty for wrong options', () => {
  const q = { type:'multi', answer_key:{correctIds:['A','C']} };
  assert.deepEqual(gradeQuestion(q,['A']),{status:'partial',points:0.5});
  assert.deepEqual(gradeQuestion(q,['A','C','E']),{status:'correct',points:1});
  assert.deepEqual(gradeQuestion(q,['B','D']),{status:'wrong',points:0});
  assert.ok(gradeQuestion(q,['A','C','B']).points <= 1);
});

test('true/false treats false as an answer, not blank', () => {
  const q = { type:'truefalse', answer_key:{correct:false} };
  assert.deepEqual(gradeQuestion(q,false),{status:'correct',points:1});
  assert.deepEqual(gradeQuestion(q,true),{status:'wrong',points:0});
  assert.equal(blankAnswer(false),false);
});

test('matching gives credit per correct pair', () => {
  const q = { type:'matching', answer_key:{pairs:{l1:'r2',l2:'r1',l3:'r3',l4:'r4'}} };
  assert.deepEqual(gradeQuestion(q,{l1:'r2',l2:'r1'}),{status:'partial',points:0.5});
  assert.deepEqual(gradeQuestion(q,{l1:'r2',l2:'r1',l3:'r3',l4:'r4'}),{status:'correct',points:1});
});

test('ordering gives credit for elements in the correct position', () => {
  const q = { type:'ordering', answer_key:{order:['i2','i1','i3']} };
  assert.deepEqual(gradeQuestion(q,['i2','i3','i1']),{status:'partial',points:1/3});
  assert.deepEqual(gradeQuestion(q,['i2','i1','i3']),{status:'correct',points:1});
});
