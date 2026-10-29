'use strict';

const blankAnswer = value => value === undefined || value === null || value === '' ||
  (Array.isArray(value) && value.length === 0) ||
  (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0);

/** Grade one question. Every question has a maximum of one point. */
function gradeQuestion(question, answer, incomplete = false) {
  const type = question.type || question.question_type;
  const key = question.answer_key || {};
  if (blankAnswer(answer)) return { status: incomplete ? 'unanswered' : 'blank', points: 0 };

  if (type === 'single') {
    const correct = String(answer) === String(key.correctId);
    return { status: correct ? 'correct' : 'wrong', points: correct ? 1 : 0 };
  }
  if (type === 'multi') {
    const selected = Array.isArray(answer) ? answer.map(String) : [];
    const correctIds = Array.isArray(key.correctIds) ? key.correctIds.map(String) : [];
    const correctCount = selected.filter(id => correctIds.includes(id)).length;
    // No penalty for wrong selections; cap at the maximum one point.
    const points = correctIds.length ? Math.min(1, correctCount / correctIds.length) : 0;
    return { status: points >= 1 ? 'correct' : points > 0 ? 'partial' : 'wrong', points };
  }
  if (type === 'truefalse') {
    const value = answer === true || answer === 'true' ? true : answer === false || answer === 'false' ? false : null;
    if (value === null) return { status: 'wrong', points: 0 };
    const correct = value === Boolean(key.correct);
    return { status: correct ? 'correct' : 'wrong', points: correct ? 1 : 0 };
  }
  if (type === 'matching') {
    const pairs = key.pairs || {};
    const given = answer && typeof answer === 'object' && !Array.isArray(answer) ? answer : {};
    const entries = Object.entries(pairs);
    const correctCount = entries.filter(([leftId, rightId]) => String(given[leftId] || '') === String(rightId)).length;
    const points = entries.length ? correctCount / entries.length : 0;
    return { status: points >= 1 ? 'correct' : points > 0 ? 'partial' : 'wrong', points };
  }
  if (type === 'ordering') {
    const target = Array.isArray(key.order) ? key.order.map(String) : [];
    const given = Array.isArray(answer) ? answer.map(String) : [];
    let correctCount = 0;
    target.forEach((id, index) => { if (given[index] === id) correctCount += 1; });
    const points = target.length ? correctCount / target.length : 0;
    return { status: points >= 1 ? 'correct' : points > 0 ? 'partial' : 'wrong', points };
  }
  return { status: 'wrong', points: 0 };
}

module.exports = { blankAnswer, gradeQuestion };
