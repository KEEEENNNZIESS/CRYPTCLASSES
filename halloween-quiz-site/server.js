'use strict';
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const XLSX = require('xlsx');
const PDFDocument = require('pdfkit');
const { blankAnswer, gradeQuestion } = require('./lib/grading');
const { validateAnswer } = require('./lib/answer-validation');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const port = Number(process.env.PORT || 3000);
const maxUploadMb = Math.min(5, Math.max(1, Number(process.env.MAX_UPLOAD_MB || 5)));
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL belum diatur. Salin .env.example menjadi .env atau gunakan docker-compose.yml.');
  process.exit(1);
}
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : undefined,
  max: Number(process.env.DB_POOL_MAX || 15),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});
const sessionSecret = process.env.SESSION_SECRET || '';
if (sessionSecret.length < 32) {
  console.warn('WARNING: SESSION_SECRET harus diganti menjadi secret acak minimal 32 karakter.');
}

app.disable('x-powered-by');
app.set('trust proxy', process.env.NODE_ENV === 'production' ? 1 : false);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", 'https://fonts.googleapis.com'],
      imgSrc: ["'self'", 'https:', 'data:'], connectSrc: ["'self'"],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'], objectSrc: ["'none'"], frameAncestors: ["'none'"],
      baseUri: ["'self'"], formAction: ["'self'"]
    }
  }, crossOriginEmbedderPolicy: false
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(session({
  name: 'cryptclass.sid',
  store: new PgSession({ pool, tableName: 'user_sessions', createTableIfMissing: true, ttl: 10 * 365 * 24 * 60 * 60, pruneSessionInterval: 24 * 60 * 60 }),
  secret: sessionSecret.length >= 32 ? sessionSecret : crypto.randomBytes(48).toString('hex'),
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === 'true',
    maxAge: 10 * 365 * 24 * 60 * 60 * 1000
  }
}));
app.use(express.static(path.join(__dirname, 'public'), { etag: true, maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0 }));

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 5, standardHeaders: true, legacyHeaders: false, message: { error: 'Terlalu banyak percobaan. Coba lagi setelah 15 menit.' } });
const joinLimiter = rateLimit({ windowMs: 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false, message: { error: 'Terlalu banyak percobaan masuk. Tunggu sebentar.' } });
const importLimiter = rateLimit({ windowMs: 60 * 1000, limit: 15, standardHeaders: true, legacyHeaders: false });
const imageUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: maxUploadMb * 1024 * 1024, files: 1 } });

const typeNames = { single: 'Pilihan ganda', multi: 'Pilihan jamak', truefalse: 'Benar / salah', matching: 'Mencocokkan', ordering: 'Mengurutkan' };
const statusNames = { draft: 'Draf', open: 'Berlangsung', closed: 'Selesai', archived: 'Arsip' };
const sha256 = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const safeEqual = (a, b) => {
  const aa = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  return aa.length === bb.length && aa.length > 0 && crypto.timingSafeEqual(aa, bb);
};
const cleanName = value => String(value || '').trim().replace(/\s+/g, ' ');
const isValidCode = code => /^[A-Za-z0-9]{4,16}$/.test(String(code || ''));
const isDate = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
const safeQuiz = q => ({
  id: q.id, code: q.code, title: q.title, subject: q.subject, description: q.description,
  class_name: q.class_name, quiz_date: q.quiz_date ? String(q.quiz_date).slice(0, 10) : '',
  teacher_name: q.teacher_name, question_type: q.question_type, status: q.status,
  created_at: q.created_at, updated_at: q.updated_at, opened_at: q.opened_at,
  closed_at: q.closed_at, archived_at: q.archived_at
});
const publicQuestion = q => ({ id: Number(q.id), position: Number(q.position), prompt: q.prompt, image_url: q.image_url, question_type: q.question_type, options: q.options });
const sendError = (res, status, message, extra = {}) => res.status(status).json({ error: message, ...extra });

async function audit(event, details = {}) {
  await pool.query('INSERT INTO audit_log(event,details) VALUES($1,$2)', [event, JSON.stringify(details)]);
}
async function setting(key) {
  const r = await pool.query('SELECT value FROM app_settings WHERE key=$1', [key]);
  return r.rows[0]?.value ?? null;
}
async function setSetting(client, key, value) {
  await client.query('INSERT INTO app_settings(key,value,updated_at) VALUES($1,$2,NOW()) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()', [key, String(value)]);
}
async function admin(req, res, next) {
  try {
    if (!req.session?.admin) return sendError(res, 401, 'Sesi admin tidak aktif. Silakan login.');
    const version = await setting('admin_auth_version') || '1';
    if (String(req.session.adminVersion) !== String(version)) {
      req.session.destroy(() => {});
      return sendError(res, 401, 'Sesi admin telah dicabut. Silakan login kembali.');
    }
    return next();
  } catch (e) { return next(e); }
}
function participantInput(req, res, next) {
  const id = req.body?.participantId;
  const token = String(req.body?.token || '');
  if (!id || !/^\d+$/.test(String(id)) || token.length < 32) return sendError(res, 400, 'Identitas sesi peserta tidak lengkap.');
  req.participantId = String(id); req.participantToken = token; next();
}

function assertQuizMetadata(b) {
  const fields = ['title', 'subject', 'description', 'class_name', 'quiz_date', 'teacher_name', 'code'];
  const missing = fields.filter(k => !String(b[k] ?? '').trim());
  if (missing.length) throw new Error(`Informasi wajib belum lengkap: ${missing.join(', ')}.`);
  if (!isValidCode(b.code)) throw new Error('Kode kuis harus 4–16 karakter huruf atau angka tanpa spasi.');
  if (!isDate(b.quiz_date)) throw new Error('Tanggal kuis tidak valid.');
  if (String(b.title).trim().length > 140) throw new Error('Judul maksimal 140 karakter.');
  if (String(b.subject).trim().length > 100) throw new Error('Mata pelajaran maksimal 100 karakter.');
  if (String(b.class_name).trim().length > 100 || String(b.teacher_name).trim().length > 100) throw new Error('Nama kelas dan guru maksimal 100 karakter.');
  if (String(b.description).trim().length > 3000) throw new Error('Deskripsi maksimal 3000 karakter.');
}

function normalizeQuestion(input, type, index) {
  const q = input || {};
  const prompt = String(q.prompt || '').trim();
  const imageUrl = String(q.image_url || '').trim() || null;
  if (!prompt) throw new Error(`Soal ${index + 1}: teks soal wajib diisi.`);
  if (prompt.length > 3000) throw new Error(`Soal ${index + 1}: teks soal terlalu panjang (maksimal 3000 karakter).`);
  if (imageUrl && !((imageUrl.startsWith('/api/media/') && /^\/api\/media\/[0-9a-f-]+$/i.test(imageUrl)) || /^https:\/\//i.test(imageUrl))) {
    throw new Error(`Soal ${index + 1}: gambar harus diunggah atau memakai URL HTTPS yang valid.`);
  }
  let options = q.options;
  let key = q.answer_key;
  const id = q.id && /^\d+$/.test(String(q.id)) ? Number(q.id) : null;
  if (type === 'single' || type === 'multi') {
    if (!Array.isArray(options) || options.length !== 5) throw new Error(`Soal ${index + 1}: ${type === 'single' ? 'pilihan ganda' : 'pilihan jamak'} harus memiliki tepat 5 opsi.`);
    options = options.map((item, j) => ({ id: String(item?.id || `o${j + 1}`), text: String(typeof item === 'string' ? item : item?.text ?? item?.label ?? '').trim() }));
    if (options.some(o => !o.text)) throw new Error(`Soal ${index + 1}: semua opsi A–E wajib diisi.`);
    if (new Set(options.map(o => o.id)).size !== 5) throw new Error(`Soal ${index + 1}: ID opsi harus unik.`);
    if (type === 'single') {
      const correctId = String(key?.correctId ?? key ?? '');
      if (!options.some(o => o.id === correctId)) throw new Error(`Soal ${index + 1}: pilih satu kunci jawaban yang ada di opsi.`);
      key = { correctId };
    } else {
      const correctIds = Array.isArray(key?.correctIds) ? key.correctIds.map(String) : Array.isArray(key) ? key.map(String) : [];
      if (!correctIds.length || correctIds.some(v => !options.some(o => o.id === v)) || new Set(correctIds).size !== correctIds.length) throw new Error(`Soal ${index + 1}: pilih satu atau lebih kunci jawaban valid untuk pilihan jamak.`);
      key = { correctIds };
    }
  } else if (type === 'truefalse') {
    options = [];
    const correct = typeof key === 'boolean' ? key : key?.correct;
    if (typeof correct !== 'boolean') throw new Error(`Soal ${index + 1}: kunci harus Benar atau Salah.`);
    key = { correct };
  } else if (type === 'matching') {
    const left = Array.isArray(options?.left) ? options.left : [];
    const right = Array.isArray(options?.right) ? options.right : [];
    if (left.length < 2 || left.length > 10 || right.length !== left.length) throw new Error(`Soal ${index + 1}: matching membutuhkan 2–10 item kiri dan jumlah item kanan yang sama.`);
    const L = left.map((v, j) => ({ id: String(v?.id || `l${j + 1}`), text: String(v?.text || '').trim() }));
    const R = right.map((v, j) => ({ id: String(v?.id || `r${j + 1}`), text: String(v?.text || '').trim() }));
    if (L.some(v => !v.text) || R.some(v => !v.text)) throw new Error(`Soal ${index + 1}: semua item matching wajib diisi.`);
    if (new Set(L.map(v => v.id)).size !== L.length || new Set(R.map(v => v.id)).size !== R.length) throw new Error(`Soal ${index + 1}: ID item matching harus unik.`);
    const pairs = key?.pairs && typeof key.pairs === 'object' ? key.pairs : key;
    if (!pairs || typeof pairs !== 'object' || Array.isArray(pairs) || Object.keys(pairs).length !== L.length) throw new Error(`Soal ${index + 1}: kunci matching harus menentukan semua pasangan.`);
    const values = Object.values(pairs).map(String);
    if (Object.keys(pairs).some(k => !L.some(v => v.id === k)) || values.some(v => !R.some(x => x.id === v)) || new Set(values).size !== values.length) throw new Error(`Soal ${index + 1}: pasangan matching tidak valid atau ada pasangan kanan ganda.`);
    options = { left: L, right: R };
    key = { pairs: Object.fromEntries(Object.entries(pairs).map(([k, v]) => [String(k), String(v)])) };
  } else if (type === 'ordering') {
    const items = Array.isArray(options?.items) ? options.items : Array.isArray(options) ? options : [];
    if (items.length < 2 || items.length > 10) throw new Error(`Soal ${index + 1}: ordering membutuhkan 2–10 elemen.`);
    options = items.map((v, j) => ({ id: String(v?.id || `i${j + 1}`), text: String(typeof v === 'string' ? v : v?.text || '').trim() }));
    if (options.some(v => !v.text) || new Set(options.map(v => v.id)).size !== options.length) throw new Error(`Soal ${index + 1}: semua elemen ordering wajib diisi dan ID-nya unik.`);
    const order = Array.isArray(key?.order) ? key.order.map(String) : Array.isArray(key) ? key.map(String) : [];
    if (order.length !== options.length || new Set(order).size !== order.length || order.some(v => !options.some(o => o.id === v))) throw new Error(`Soal ${index + 1}: kunci urutan harus mencakup semua elemen tepat satu kali.`);
    key = { order };
  } else {
    throw new Error('Jenis soal tidak dikenal.');
  }
  return { id, question_type: type, prompt, image_url: imageUrl, options, answer_key: key };
}

async function gradeAttempt(client, quizId, answers, incomplete = false) {
  const q = await client.query('SELECT id,position,answer_key,question_type FROM questions WHERE quiz_id=$1 ORDER BY position', [quizId]);
  const results = q.rows.map(question => {
    const answer = answers?.[String(question.id)];
    const scored = gradeQuestion({ ...question, type: question.question_type }, answer, incomplete);
    const result = { questionId: Number(question.id), position: Number(question.position), status: scored.status, points: Number(scored.points.toFixed(4)), maxPoints: 1 };
    // Safe per-item feedback: send only status, never the expected matching target.
    if (question.question_type === 'matching') {
      const pairs = question.answer_key?.pairs || {};
      const given = answer && typeof answer === 'object' && !Array.isArray(answer) ? answer : {};
      result.pairResults = Object.keys(pairs).map(leftId => ({
        leftId,
        status: !given[leftId] ? 'unanswered' : String(given[leftId]) === String(pairs[leftId]) ? 'correct' : 'wrong'
      }));
    } else if (question.question_type === 'ordering') {
      const order = Array.isArray(question.answer_key?.order) ? question.answer_key.order.map(String) : [];
      const given = Array.isArray(answer) ? answer.map(String) : [];
      result.itemResults = order.map((id, index) => ({ index, status: !given[index] ? 'unanswered' : given[index] === id ? 'correct' : 'wrong' }));
    } else if (question.question_type === 'multi') {
      const correctIds = Array.isArray(question.answer_key?.correctIds) ? question.answer_key.correctIds.map(String) : [];
      const selected = Array.isArray(answer) ? answer.map(String) : [];
      // Only report correctness for choices the student selected. Unselected choices stay neutral
      // so this feedback cannot reveal the answer key.
      result.itemResults = selected.map(id => ({ optionId: id, status: correctIds.includes(id) ? 'correct' : 'wrong' }));
      result.missingSelections = correctIds.some(id => !selected.includes(id));
    }
    return result;
  });
  const score = results.length ? Number((results.reduce((sum, result) => sum + result.points, 0) / results.length * 100).toFixed(2)) : 0;
  return { score, results };
}

async function saveQuestions(quizId, incoming) {
  if (!Array.isArray(incoming) || incoming.length < 1 || incoming.length > 300) throw new Error('Kuis harus memiliki 1–300 soal.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const quizR = await client.query('SELECT * FROM quizzes WHERE id=$1 FOR UPDATE', [quizId]);
    const quiz = quizR.rows[0];
    if (!quiz) throw Object.assign(new Error('Kuis tidak ditemukan.'), { status: 404 });
    if (['closed', 'archived'].includes(quiz.status)) throw Object.assign(new Error('Kuis yang sudah ditutup hanya dapat dilihat dan diekspor.'), { status: 409 });
    const normalized = incoming.map((item, i) => normalizeQuestion(item, item?.question_type || quiz.question_type, i));
    const ids = normalized.filter(q => q.id).map(q => q.id);
    if (ids.length && new Set(ids).size !== ids.length) throw new Error('Ada ID soal yang berulang. Muat ulang editor dan coba lagi.');
    if (ids.length) {
      const owned = await client.query('SELECT id FROM questions WHERE quiz_id=$1 AND id=ANY($2::bigint[])', [quizId, ids]);
      if (owned.rowCount !== ids.length) throw new Error('Ada soal yang bukan milik kuis ini. Muat ulang editor.');
    }
    await client.query('UPDATE questions SET position = -position - 1000000 WHERE quiz_id=$1', [quizId]);
    const kept = [];
    for (let i = 0; i < normalized.length; i++) {
      const q = normalized[i];
      if (q.id) {
        await client.query('UPDATE questions SET position=$1,question_type=$2,prompt=$3,image_url=$4,options=$5,answer_key=$6,updated_at=NOW() WHERE id=$7 AND quiz_id=$8', [i + 1, q.question_type, q.prompt, q.image_url, JSON.stringify(q.options), JSON.stringify(q.answer_key), q.id, quizId]);
        kept.push(q.id);
      } else {
        const inserted = await client.query('INSERT INTO questions(quiz_id,position,question_type,prompt,image_url,options,answer_key) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id', [quizId, i + 1, q.question_type, q.prompt, q.image_url, JSON.stringify(q.options), JSON.stringify(q.answer_key)]);
        kept.push(Number(inserted.rows[0].id));
      }
    }
    if (kept.length) await client.query('DELETE FROM questions WHERE quiz_id=$1 AND NOT (id=ANY($2::bigint[]))', [quizId, kept]);
    else await client.query('DELETE FROM questions WHERE quiz_id=$1', [quizId]);
    await client.query('UPDATE quizzes SET updated_at=NOW() WHERE id=$1', [quizId]);
    // If the quiz is open, a changed answer key/question set applies consistently to everyone,
    // including already-submitted participants. Recalculate all submitted current attempts.
    if (quiz.status === 'open') {
      const submitted = await client.query("SELECT a.id,a.answers FROM attempts a JOIN participants p ON p.id=a.participant_id WHERE p.quiz_id=$1 AND a.active=TRUE AND a.state='submitted' FOR UPDATE OF a", [quizId]);
      for (const attempt of submitted.rows) {
        const graded = await gradeAttempt(client, quizId, attempt.answers || {}, false);
        await client.query('UPDATE attempts SET score=$1,question_results=$2,updated_at=NOW() WHERE id=$3', [graded.score, JSON.stringify(graded.results), attempt.id]);
      }
    }
    await client.query('COMMIT');
    return { ok: true, count: normalized.length };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally { client.release(); }
}

function parseImportRow(row, type, index) {
  const prompt = String(row.prompt ?? row.question ?? row.soal ?? '').trim();
  const image_url = String(row.image_url ?? row.image ?? '').trim() || null;
  const keyRaw = String(row.answer_key ?? row.key ?? row.kunci ?? '').trim();
  if (!prompt) throw new Error('Kolom prompt/soal kosong.');
  const getOpt = (letter, n) => String(row[`option_${letter}`] ?? row[letter.toUpperCase()] ?? row[`opsi_${letter}`] ?? '').trim();
  if (type === 'single' || type === 'multi') {
    const texts = ['a','b','c','d','e'].map((letter, i) => getOpt(letter, i));
    if (texts.some(t => !t)) throw new Error('Kolom option_a sampai option_e harus terisi.');
    const options = texts.map((text, i) => ({ id: `o${i + 1}`, text }));
    const letters = keyRaw.toUpperCase().replace(/\s/g, '').split(',').filter(Boolean);
    const indexes = letters.map(l => ({ A: 0, B: 1, C: 2, D: 3, E: 4 })[l] ?? (/^[1-5]$/.test(l) ? Number(l) - 1 : -1));
    if (type === 'single') {
      if (indexes.length !== 1 || indexes[0] < 0) throw new Error('Kunci pilihan ganda harus satu huruf A–E (contoh: C).');
      return { prompt, image_url, options, answer_key: { correctId: `o${indexes[0] + 1}` } };
    }
    if (!indexes.length || indexes.some(i => i < 0) || new Set(indexes).size !== indexes.length) throw new Error('Kunci pilihan jamak harus berisi huruf opsi, contoh: A,C.');
    return { prompt, image_url, options, answer_key: { correctIds: indexes.map(i => `o${i + 1}`) } };
  }
  if (type === 'truefalse') {
    const v = keyRaw.toLowerCase();
    if (!['true','false','benar','salah','b','s'].includes(v)) throw new Error('Kunci benar/salah harus TRUE, FALSE, BENAR, atau SALAH.');
    return { prompt, image_url, options: [], answer_key: { correct: ['true','benar','b'].includes(v) } };
  }
  if (type === 'matching') {
    const leftText = String(row.left_items ?? row.left ?? '').split(';').map(s => s.trim()).filter(Boolean);
    const rightText = String(row.right_items ?? row.right ?? '').split(';').map(s => s.trim()).filter(Boolean);
    if (leftText.length < 2 || leftText.length > 10 || leftText.length !== rightText.length) throw new Error('Matching: isi left_items dan right_items dengan 2–10 item dipisahkan titik koma (;), jumlahnya harus sama.');
    const pairParts = keyRaw.split(';').map(s => s.trim()).filter(Boolean);
    const pairs = {};
    for (const part of pairParts) {
      const m = part.match(/^(\d+)\s*=\s*(\d+)$/);
      if (!m) throw new Error('Kunci matching gunakan format 1=2;2=1;3=3.');
      const l = Number(m[1]); const r = Number(m[2]);
      if (l < 1 || l > leftText.length || r < 1 || r > rightText.length) throw new Error('Indeks pasangan matching di luar rentang item.');
      pairs[`l${l}`] = `r${r}`;
    }
    return { prompt, image_url, options: { left: leftText.map((text, i) => ({ id: `l${i + 1}`, text })), right: rightText.map((text, i) => ({ id: `r${i + 1}`, text })) }, answer_key: { pairs } };
  }
  if (type === 'ordering') {
    const itemsRaw = String(row.items ?? row.order_items ?? '').split(';').map(s => s.trim()).filter(Boolean);
    if (itemsRaw.length < 2 || itemsRaw.length > 10) throw new Error('Ordering: isi kolom items dengan 2–10 elemen dipisahkan titik koma (;).');
    const orderNums = keyRaw.split(',').map(s => Number(s.trim()));
    if (orderNums.length !== itemsRaw.length || orderNums.some(n => !Number.isInteger(n) || n < 1 || n > itemsRaw.length) || new Set(orderNums).size !== orderNums.length) throw new Error('Kunci ordering gunakan nomor urutan indeks, contoh 3,1,2.');
    return { prompt, image_url, options: { items: itemsRaw.map((text, i) => ({ id: `i${i + 1}`, text })) }, answer_key: { order: orderNums.map(n => `i${n}`) } };
  }
  throw new Error('Tipe soal tidak valid.');
}
function parsePastedText(text, type) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const blocks = [];
  let current = null;
  for (const line of lines) {
    const start = line.match(/^\s*(\d{1,3})[.)]\s*(.*?)\s*$/);
    if (start) {
      if (current) blocks.push(current);
      current = { prompt: start[2], option_a: '', option_b: '', option_c: '', option_d: '', option_e: '', answer_key: '' };
      continue;
    }
    if (!current || !line.trim()) continue;
    let m;
    if ((m = line.match(/^\s*([A-E])\s*[.)]\s*(.+)$/i))) current[`option_${m[1].toLowerCase()}`] = m[2].trim();
    else if ((m = line.match(/^\s*(?:kunci|jawaban)\s*:\s*(.+)$/i))) current.answer_key = m[1].trim();
    else if ((m = line.match(/^\s*(?:gambar|image_url)\s*:\s*(.+)$/i))) current.image_url = m[1].trim();
    else if ((m = line.match(/^\s*(?:kiri|left_items)\s*:\s*(.+)$/i))) current.left_items = m[1].trim();
    else if ((m = line.match(/^\s*(?:kanan|right_items)\s*:\s*(.+)$/i))) current.right_items = m[1].trim();
    else if ((m = line.match(/^\s*(?:items|elemen)\s*:\s*(.+)$/i))) current.items = m[1].trim();
  }
  if (current) blocks.push(current);
  if (!blocks.length) throw new Error('Tidak ada soal terdeteksi. Gunakan format bernomor: 1. Teks soal.');
  const questions = []; const errors = [];
  blocks.forEach((row, i) => {
    try { questions.push(parseImportRow(row, type, i)); }
    catch (e) { errors.push({ row: i + 1, message: e.message }); }
  });
  return { total: blocks.length, questions: errors.length ? [] : questions, errors, preview: blocks.map((row,i)=>({row:i+1,prompt:String(row.prompt||'').slice(0,180)})) };
}
function importTemplate(type) {
  const base = ['prompt','image_url'];
  let headers;
  let sample;
  if (type === 'single' || type === 'multi') {
    headers = [...base, 'option_a','option_b','option_c','option_d','option_e','answer_key'];
    sample = ['Contoh pertanyaan','', 'Pilihan A','Pilihan B','Pilihan C','Pilihan D','Pilihan E', type === 'single' ? 'C' : 'A,C'];
  } else if (type === 'truefalse') {
    headers = [...base,'answer_key']; sample = ['Matahari terbit dari timur.','','BENAR'];
  } else if (type === 'matching') {
    headers = [...base,'left_items','right_items','answer_key']; sample = ['Cocokkan pasangan','','Kucing;Anjing','Meong;Gonggong','1=1;2=2'];
  } else {
    headers = [...base,'items','answer_key']; sample = ['Urutkan tahap berikut','','Bangun;Sarapan;Berangkat','2,1,3'];
  }
  const esc = v => `"${String(v ?? '').replace(/"/g,'""')}"`;
  return `${headers.map(esc).join(',')}\r\n${sample.map(esc).join(',')}\r\n`;
}

async function getReport(quizId) {
  const qR = await pool.query('SELECT * FROM quizzes WHERE id=$1', [quizId]);
  if (!qR.rows[0]) throw Object.assign(new Error('Kuis tidak ditemukan.'), { status: 404 });
  const quiz = qR.rows[0];
  const qRows = (await pool.query('SELECT * FROM questions WHERE quiz_id=$1 ORDER BY position', [quizId])).rows;
  const pRows = (await pool.query('SELECT * FROM participants WHERE quiz_id=$1 ORDER BY LOWER(display_name)', [quizId])).rows;
  const pIds = pRows.map(p => Number(p.id));
  const histories = pIds.length ? (await pool.query('SELECT * FROM attempts WHERE participant_id=ANY($1::bigint[]) ORDER BY participant_id,attempt_number DESC,created_at DESC', [pIds])).rows : [];
  const grouped = new Map();
  histories.forEach(a => { const k = Number(a.participant_id); if (!grouped.has(k)) grouped.set(k, []); grouped.get(k).push(a); });
  const participants = pRows.map(p => {
    const history = grouped.get(Number(p.id)) || [];
    const active = history.find(a => a.active) || history[0] || null;
    return { id: Number(p.id), display_name: p.display_name, status: p.status, joined_at: p.joined_at, last_seen_at: p.last_seen_at,
      answers: active?.answers || {}, score: active?.score === null || active?.score === undefined ? null : Number(active.score),
      question_results: active?.question_results || [], attempt_state: active?.state || null, attempt_number: active?.attempt_number || null,
      history: history.map(a => ({ id: Number(a.id), attempt_number: a.attempt_number, score: a.score === null ? null : Number(a.score), state: a.state, active: a.active, created_at: a.created_at, submitted_at: a.submitted_at, answers: a.answers, question_results: a.question_results })) };
  });
  const scoredParticipants = participants.filter(p => p.score !== null);
  const scores = scoredParticipants.map(p => p.score);
  const questionAnalysis = qRows.map(q => {
    const per = [];
    participants.filter(p => p.score !== null).forEach(p => {
      const result = (p.question_results || []).find(x => Number(x.questionId) === Number(q.id));
      if (result && result.status !== 'unanswered') per.push(result);
    });
    const wrong = per.filter(x => x.status === 'wrong').length;
    const blank = per.filter(x => x.status === 'blank').length;
    const partial = per.filter(x => x.status === 'partial').length;
    const sample = per.length;
    return { id: Number(q.id), position: Number(q.position), prompt: q.prompt, sample_size: sample, wrong_count: wrong, blank_count: blank, partial_count: partial,
      wrong_pct: sample ? Number((wrong / sample * 100).toFixed(1)) : 0, blank_pct: sample ? Number((blank / sample * 100).toFixed(1)) : 0 };
  });
  const completed = participants.filter(p => p.status === 'completed').length;
  const locked = participants.filter(p => p.status === 'locked').length;
  const inProgress = participants.filter(p => p.status === 'in_progress').length;
  const stats = { joined: participants.length, in_progress: inProgress, completed, locked,
    highest: scores.length ? Math.max(...scores) : null, lowest: scores.length ? Math.min(...scores) : null,
    average: scores.length ? Number((scores.reduce((a,b)=>a+b,0)/scores.length).toFixed(2)) : null,
    graded: scores.length, question_count: qRows.length };
  const leaderboard = participants.filter(p => p.score !== null).sort((a,b) => b.score - a.score || a.display_name.localeCompare(b.display_name, 'id')).map((p, i) => ({ rank: i+1, name: p.display_name, score: p.score, status: p.status }));
  return { quiz: safeQuiz(quiz), questions: qRows.map(q => ({ id: Number(q.id), position: Number(q.position), prompt: q.prompt, image_url: q.image_url, question_type: q.question_type, options: q.options, answer_key: q.answer_key })), participants, stats, questionAnalysis, leaderboard };
}

function labelForAnswer(question, answer) {
  if (blankAnswer(answer)) return '—';
  const type = question.question_type;
  if (type === 'single' || type === 'multi') {
    const values = Array.isArray(answer) ? answer : [answer];
    return values.map(id => question.options.find(o => String(o.id) === String(id))?.text || String(id)).join(' | ');
  }
  if (type === 'truefalse') return answer === true ? 'Benar' : answer === false ? 'Salah' : String(answer);
  if (type === 'matching') {
    const pairs = answer || {};
    return Object.entries(pairs).map(([l,r]) => `${question.options.left?.find(x=>x.id===l)?.text || l} → ${question.options.right?.find(x=>x.id===r)?.text || r}`).join('; ') || '—';
  }
  if (type === 'ordering') return (Array.isArray(answer) ? answer : []).map((id,i) => `${i+1}. ${question.options.items?.find(x=>x.id===id)?.text || id}`).join(' | ') || '—';
  return JSON.stringify(answer);
}

async function init() {
  await pool.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  app.listen(port, () => console.log(`CryptClass berjalan di http://localhost:${port}`));
}

app.get('/api/health', async (_req, res) => {
  try { await pool.query('SELECT 1'); res.json({ ok: true, database: 'connected', version: '1.0.0' }); }
  catch (e) { res.status(503).json({ ok: false, database: 'unavailable', error: 'Database belum bisa diakses.' }); }
});
app.get('/api/setup/status', async (_req,res,next) => {
  try { res.json({ configured: Boolean(await setting('admin_pin_hash')) }); } catch(e) { next(e); }
});
app.post('/api/setup', loginLimiter, async (req,res,next) => {
  const pin = String(req.body?.pin || '');
  const recoveryCode = String(req.body?.recoveryCode || '').trim();
  if (pin.length < 6 || pin.length > 64) return sendError(res,400,'PIN admin harus 6–64 karakter.');
  if (recoveryCode.length < 10 || recoveryCode.length > 100) return sendError(res,400,'Kode pemulihan harus 10–100 karakter. Simpan kode ini di tempat aman.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(867530900)');
    const exists = await client.query("SELECT value FROM app_settings WHERE key='admin_pin_hash'");
    if (exists.rowCount) { await client.query('ROLLBACK'); return sendError(res,409,'Setup admin sudah dilakukan.'); }
    await setSetting(client,'admin_pin_hash',await bcrypt.hash(pin,12));
    await setSetting(client,'admin_recovery_hash',await bcrypt.hash(recoveryCode,12));
    await setSetting(client,'admin_auth_version','1');
    await client.query('INSERT INTO audit_log(event,details) VALUES($1,$2)', ['admin_setup',JSON.stringify({ at: new Date().toISOString() })]);
    await client.query('COMMIT');
    res.status(201).json({ ok:true, message:'Admin berhasil dibuat. Simpan kode pemulihan sekarang.' });
  } catch(e) { await client.query('ROLLBACK'); next(e); } finally { client.release(); }
});
app.post('/api/admin/login', loginLimiter, async (req,res,next) => {
  try {
    const pin = String(req.body?.pin || '');
    const hash = await setting('admin_pin_hash');
    if (!hash) return sendError(res,409,'Setup admin terlebih dahulu.');
    if (!(await bcrypt.compare(pin,hash))) return sendError(res,401,'PIN admin salah. Coba lagi dengan hati-hati.');
    const version = await setting('admin_auth_version') || '1';
    req.session.regenerate(err => {
      if (err) return next(err);
      req.session.admin = true; req.session.adminVersion = version;
      req.session.save(saveErr => saveErr ? next(saveErr) : res.json({ ok:true }));
    });
  } catch(e) { next(e); }
});
app.post('/api/admin/recover', loginLimiter, async (req,res,next) => {
  try {
    const code = String(req.body?.recoveryCode || '').trim();
    const newPin = String(req.body?.newPin || '');
    const hash = await setting('admin_recovery_hash');
    if (!hash || !(await bcrypt.compare(code,hash))) return sendError(res,401,'Kode pemulihan tidak cocok.');
    if (newPin.length < 6 || newPin.length > 64) return sendError(res,400,'PIN baru harus 6–64 karakter.');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await setSetting(client,'admin_pin_hash',await bcrypt.hash(newPin,12));
      const version = Number(await setting('admin_auth_version') || 1) + 1;
      await setSetting(client,'admin_auth_version',String(version));
      await client.query('INSERT INTO audit_log(event,details) VALUES($1,$2)', ['admin_pin_recovered',JSON.stringify({ at: new Date().toISOString() })]);
      await client.query('COMMIT');
    } catch(e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
    req.session.destroy(() => {});
    res.json({ ok:true, message:'PIN diubah dan semua sesi admin lama dicabut. Silakan login ulang.' });
  } catch(e) { next(e); }
});
app.get('/api/admin/me', (req,res) => res.json({ authenticated: !!req.session?.admin }));
app.post('/api/admin/logout', (req,res) => req.session.destroy(err => {
  res.clearCookie('cryptclass.sid', { httpOnly:true, sameSite:'lax', secure:process.env.COOKIE_SECURE==='true' });
  if(err) return res.status(500).json({error:'Logout gagal.'}); res.json({ok:true});
}));

app.get('/api/admin/dashboard', admin, async (_req,res,next) => {
  try {
    const qs = await pool.query(`SELECT q.*,
      (SELECT COUNT(*) FROM participants p WHERE p.quiz_id=q.id) AS participant_count,
      (SELECT COUNT(*) FROM participants p WHERE p.quiz_id=q.id AND p.status='in_progress') AS in_progress_count,
      (SELECT COUNT(*) FROM participants p WHERE p.quiz_id=q.id AND p.status='completed') AS completed_count,
      (SELECT COUNT(*) FROM participants p WHERE p.quiz_id=q.id AND p.status='locked') AS locked_count
      FROM quizzes q ORDER BY q.created_at DESC`);
    const summaries = qs.rows.map(q => ({ ...safeQuiz(q), participant_count:Number(q.participant_count), in_progress_count:Number(q.in_progress_count), completed_count:Number(q.completed_count), locked_count:Number(q.locked_count) }));
    const totalParticipants = summaries.reduce((n,q)=>n+q.participant_count,0);
    const counts = { quizzes:summaries.length, open:summaries.filter(q=>q.status==='open').length, participants:totalParticipants, completed:summaries.reduce((n,q)=>n+q.completed_count,0) };
    res.json({ quizzes:summaries, counts });
  } catch(e) { next(e); }
});
app.get('/api/admin/quizzes', admin, async (_req,res,next) => {
  try {
    const r = await pool.query(`SELECT q.*,
      (SELECT COUNT(*) FROM participants p WHERE p.quiz_id=q.id) AS participant_count,
      (SELECT COUNT(*) FROM participants p WHERE p.quiz_id=q.id AND p.status='in_progress') AS in_progress_count,
      (SELECT COUNT(*) FROM participants p WHERE p.quiz_id=q.id AND p.status='completed') AS completed_count,
      (SELECT COUNT(*) FROM participants p WHERE p.quiz_id=q.id AND p.status='locked') AS locked_count
      FROM quizzes q ORDER BY created_at DESC`);
    res.json(r.rows.map(q=>({...safeQuiz(q),participant_count:Number(q.participant_count),in_progress_count:Number(q.in_progress_count),completed_count:Number(q.completed_count),locked_count:Number(q.locked_count)})));
  } catch(e) { next(e); }
});
app.post('/api/admin/quizzes', admin, async (req,res,next) => {
  try {
    const b = req.body || {}; assertQuizMetadata(b);
    if (!Object.hasOwn(typeNames,b.question_type)) return sendError(res,400,'Jenis soal tidak valid.');
    const params = [b.code.toUpperCase(),String(b.title).trim(),String(b.subject).trim(),String(b.description).trim(),String(b.class_name).trim(),b.quiz_date,String(b.teacher_name).trim(),b.question_type];
    const r = await pool.query('INSERT INTO quizzes(code,title,subject,description,class_name,quiz_date,teacher_name,question_type) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',params);
    await audit('quiz_created',{quizId:Number(r.rows[0].id),code:r.rows[0].code});
    res.status(201).json(safeQuiz(r.rows[0]));
  } catch(e) { if(e.code==='23505') return sendError(res,409,'Kode kuis sudah digunakan. Pilih kode lain.'); if(!e.status && e instanceof Error && !e.code) return sendError(res,400,e.message); next(e); }
});
app.get('/api/admin/quizzes/:id', admin, async (req,res,next) => {
  try {
    const r = await pool.query('SELECT * FROM quizzes WHERE id=$1',[req.params.id]);
    if(!r.rows[0]) return sendError(res,404,'Kuis tidak ditemukan.');
    const questions = await pool.query('SELECT * FROM questions WHERE quiz_id=$1 ORDER BY position',[req.params.id]);
    res.json({...safeQuiz(r.rows[0]), questions:questions.rows.map(q=>({...q,id:Number(q.id),quiz_id:Number(q.quiz_id),position:Number(q.position)}))});
  } catch(e) { next(e); }
});
app.put('/api/admin/quizzes/:id', admin, async (req,res,next) => {
  try {
    const b = req.body || {}; assertQuizMetadata(b);
    const oldR = await pool.query('SELECT * FROM quizzes WHERE id=$1',[req.params.id]);
    const old = oldR.rows[0];
    if(!old) return sendError(res,404,'Kuis tidak ditemukan.');
    if(['closed','archived'].includes(old.status)) return sendError(res,409,'Kuis yang telah ditutup hanya dapat dilihat dan diekspor.');
    // Question types are selected individually in the editor; quiz.question_type remains a legacy default for imports.
    const r = await pool.query('UPDATE quizzes SET code=$1,title=$2,subject=$3,description=$4,class_name=$5,quiz_date=$6,teacher_name=$7,updated_at=NOW() WHERE id=$8 RETURNING *', [b.code.toUpperCase(),String(b.title).trim(),String(b.subject).trim(),String(b.description).trim(),String(b.class_name).trim(),b.quiz_date,String(b.teacher_name).trim(),req.params.id]);
    await audit('quiz_updated',{quizId:Number(req.params.id),status:old.status});
    res.json(safeQuiz(r.rows[0]));
  } catch(e) { if(e.code==='23505') return sendError(res,409,'Kode kuis sudah digunakan.'); if(!e.status && e instanceof Error && !e.code) return sendError(res,400,e.message); next(e); }
});
app.put('/api/admin/quizzes/:id/questions', admin, async (req,res,next) => {
  try { res.json(await saveQuestions(req.params.id,req.body?.questions)); }
  catch(e) { if(e.status) return sendError(res,e.status,e.message); if(e.code==='23505') return sendError(res,409,'Urutan soal bentrok. Muat ulang dan simpan lagi.'); if(e instanceof Error) return sendError(res,400,e.message); next(e); }
});
app.post('/api/admin/quizzes/:id/status', admin, async (req,res,next) => {
  const desired = String(req.body?.status || '');
  if(!['open','closed','archived'].includes(desired)) return sendError(res,400,'Status yang diminta tidak valid.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const qr = await client.query('SELECT * FROM quizzes WHERE id=$1 FOR UPDATE',[req.params.id]);
    const q = qr.rows[0];
    if(!q) { await client.query('ROLLBACK'); return sendError(res,404,'Kuis tidak ditemukan.'); }
    if(desired==='open') {
      if(q.status==='open') { await client.query('COMMIT'); return res.json(safeQuiz(q)); }
      if(q.status!=='draft') { await client.query('ROLLBACK'); return sendError(res,409,'Kuis yang sudah ditutup tidak dapat dibuka kembali.'); }
      const questions = await client.query('SELECT * FROM questions WHERE quiz_id=$1 ORDER BY position',[q.id]);
      if(!questions.rowCount) { await client.query('ROLLBACK'); return sendError(res,400,'Tambahkan minimal satu soal sebelum membuka kuis.'); }
      try { questions.rows.forEach((x,i)=>normalizeQuestion(x,x.question_type || q.question_type,i)); }
      catch(e) { await client.query('ROLLBACK'); return sendError(res,400,`Soal belum valid: ${e.message}`); }
      const updated = await client.query("UPDATE quizzes SET status='open',opened_at=NOW(),updated_at=NOW() WHERE id=$1 RETURNING *",[q.id]);
      await client.query('INSERT INTO audit_log(event,details) VALUES($1,$2)',['quiz_opened',JSON.stringify({quizId:Number(q.id),code:q.code})]);
      await client.query('COMMIT'); return res.json(safeQuiz(updated.rows[0]));
    }
    if(desired==='closed') {
      if(['closed','archived'].includes(q.status)) { await client.query('COMMIT'); return res.json(safeQuiz(q)); }
      if(q.status!=='open') { await client.query('ROLLBACK'); return sendError(res,409,'Kuis draf belum dapat ditutup.'); }
      const stale = await client.query("SELECT id,display_name,last_seen_at FROM participants WHERE quiz_id=$1 AND status='in_progress' AND last_seen_at < NOW() - INTERVAL '90 seconds' ORDER BY display_name",[q.id]);
      if(stale.rowCount && req.body?.confirmStale!==true) { await client.query('ROLLBACK'); return res.status(409).json({error:`Ada ${stale.rowCount} peserta yang tidak tersambung/aktif lebih dari 90 detik. Jawaban lokal yang belum diterima server tidak bisa dipastikan tersimpan. Tutup tetap?`,needsConfirmation:true,staleParticipants:stale.rows.map(p=>p.display_name)}); }
      const active = await client.query("SELECT p.id AS participant_id,a.id AS attempt_id,a.answers FROM participants p JOIN attempts a ON a.participant_id=p.id AND a.active=TRUE WHERE p.quiz_id=$1 AND p.status='in_progress' FOR UPDATE OF p,a",[q.id]);
      for(const a of active.rows) {
        const g = await gradeAttempt(client,q.id,a.answers||{},true);
        await client.query("UPDATE attempts SET score=$1,question_results=$2,state='locked',submitted_at=NOW(),updated_at=NOW() WHERE id=$3",[g.score,JSON.stringify(g.results),a.attempt_id]);
        await client.query("UPDATE participants SET status='locked' WHERE id=$1",[a.participant_id]);
      }
      const updated = await client.query("UPDATE quizzes SET status='closed',closed_at=NOW(),updated_at=NOW() WHERE id=$1 RETURNING *",[q.id]);
      await client.query('INSERT INTO audit_log(event,details) VALUES($1,$2)',['quiz_closed',JSON.stringify({quizId:Number(q.id),lockedParticipants:active.rowCount})]);
      await client.query('COMMIT'); return res.json({...safeQuiz(updated.rows[0]),lockedParticipants:active.rowCount});
    }
    if(desired==='archived') {
      if(q.status!=='closed') { await client.query('ROLLBACK'); return sendError(res,409,'Hanya kuis yang sudah selesai yang dapat diarsipkan.'); }
      const updated = await client.query("UPDATE quizzes SET status='archived',archived_at=NOW(),updated_at=NOW() WHERE id=$1 RETURNING *",[q.id]);
      await client.query('INSERT INTO audit_log(event,details) VALUES($1,$2)',['quiz_archived',JSON.stringify({quizId:Number(q.id),code:q.code})]);
      await client.query('COMMIT'); return res.json(safeQuiz(updated.rows[0]));
    }
  } catch(e) { await client.query('ROLLBACK'); next(e); } finally { client.release(); }
});
app.post('/api/admin/quizzes/:id/duplicate', admin, async (req,res,next) => {
  const client = await pool.connect();
  try {
    const code = String(req.body?.code || '').toUpperCase().trim();
    if(!isValidCode(code)) return sendError(res,400,'Kode duplikat harus 4–16 huruf/angka.');
    await client.query('BEGIN');
    const oldR = await client.query('SELECT * FROM quizzes WHERE id=$1',[req.params.id]);
    const old = oldR.rows[0];
    if(!old) { await client.query('ROLLBACK'); return sendError(res,404,'Kuis asal tidak ditemukan.'); }
    const ins = await client.query('INSERT INTO quizzes(code,title,subject,description,class_name,quiz_date,teacher_name,question_type,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,\'draft\') RETURNING *',
      [code,`${old.title} (Salinan)`,old.subject,old.description,old.class_name,old.quiz_date,old.teacher_name,old.question_type]);
    const questions = await client.query('SELECT * FROM questions WHERE quiz_id=$1 ORDER BY position',[old.id]);
    for(const q of questions.rows) await client.query('INSERT INTO questions(quiz_id,position,question_type,prompt,image_url,options,answer_key) VALUES($1,$2,$3,$4,$5,$6,$7)',[ins.rows[0].id,q.position,q.question_type || old.question_type,q.prompt,q.image_url,JSON.stringify(q.options),JSON.stringify(q.answer_key)]);
    await client.query('INSERT INTO audit_log(event,details) VALUES($1,$2)',['quiz_duplicated',JSON.stringify({quizId:Number(ins.rows[0].id),sourceQuizId:Number(old.id),code})]);
    await client.query('COMMIT'); res.status(201).json(safeQuiz(ins.rows[0]));
  } catch(e) { await client.query('ROLLBACK'); if(e.code==='23505') return sendError(res,409,'Kode tersebut sudah digunakan.'); next(e); }
  finally { client.release(); }
});
app.delete('/api/admin/quizzes/:id', admin, async (req,res,next) => {
  if(req.body?.confirm!==true) return sendError(res,400,'Konfirmasi penghapusan wajib.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query('SELECT id FROM quizzes WHERE id=$1 FOR UPDATE',[req.params.id]);
    if(!r.rows[0]) { await client.query('ROLLBACK'); return sendError(res,404,'Kuis tidak ditemukan.'); }
    await client.query("DELETE FROM audit_log WHERE details->>'quizId'=$1 OR details->>'sourceQuizId'=$1",[String(req.params.id)]);
    await client.query('DELETE FROM quizzes WHERE id=$1',[req.params.id]);
    await client.query('COMMIT'); res.json({ok:true});
  } catch(e) { await client.query('ROLLBACK'); next(e); } finally { client.release(); }
});
app.get('/api/admin/quizzes/:id/report', admin, async (req,res,next) => {
  try { res.json(await getReport(req.params.id)); } catch(e) { if(e.status) return sendError(res,e.status,e.message); next(e); }
});
app.post('/api/admin/participants/:id/reset', admin, async (req,res,next) => {
  if(req.body?.confirm!==true) return sendError(res,400,'Konfirmasi reset wajib.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const pr = await client.query('SELECT p.*,q.status AS quiz_status FROM participants p JOIN quizzes q ON q.id=p.quiz_id WHERE p.id=$1 FOR UPDATE OF p',[req.params.id]);
    const p = pr.rows[0];
    if(!p) { await client.query('ROLLBACK'); return sendError(res,404,'Peserta tidak ditemukan.'); }
    if(p.quiz_status!=='open') { await client.query('ROLLBACK'); return sendError(res,409,'Percobaan hanya dapat direset saat kuis masih terbuka.'); }
    const cur = await client.query('SELECT attempt_number FROM attempts WHERE participant_id=$1 AND active=TRUE FOR UPDATE',[p.id]);
    if(cur.rows[0]) await client.query('UPDATE attempts SET active=FALSE WHERE participant_id=$1 AND active=TRUE',[p.id]);
    const attemptNumber = Number(cur.rows[0]?.attempt_number || 0) + 1;
    await client.query("INSERT INTO attempts(participant_id,attempt_number,answers,state,active) VALUES($1,$2,'{}'::jsonb,'in_progress',TRUE)",[p.id,attemptNumber]);
    await client.query("UPDATE participants SET status='in_progress',last_seen_at=NOW() WHERE id=$1",[p.id]);
    await client.query('INSERT INTO audit_log(event,details) VALUES($1,$2)',['participant_attempt_reset',JSON.stringify({participantId:Number(p.id),quizId:Number(p.quiz_id),attemptNumber})]);
    await client.query('COMMIT'); res.json({ok:true,attemptNumber});
  } catch(e) { await client.query('ROLLBACK'); next(e); } finally { client.release(); }
});
app.delete('/api/admin/participants/:id', admin, async (req,res,next) => {
  if(req.body?.confirm!==true) return sendError(res,400,'Konfirmasi penghapusan data peserta wajib.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const pr = await client.query('SELECT id,quiz_id FROM participants WHERE id=$1 FOR UPDATE',[req.params.id]);
    if(!pr.rows[0]) { await client.query('ROLLBACK'); return sendError(res,404,'Peserta tidak ditemukan.'); }
    // The chosen privacy policy is full deletion, including any audit details that identify this participant, without creating a deletion event.
    await client.query("DELETE FROM audit_log WHERE details->>'participantId'=$1",[String(req.params.id)]);
    await client.query('DELETE FROM participants WHERE id=$1',[req.params.id]);
    await client.query('COMMIT'); res.json({ok:true});
  } catch(e) { await client.query('ROLLBACK'); next(e); } finally { client.release(); }
});

app.get('/api/admin/quizzes/:id/template.csv', admin, async (req,res,next) => {
  try {
    const r = await pool.query('SELECT code,question_type FROM quizzes WHERE id=$1',[req.params.id]);
    if(!r.rows[0]) return sendError(res,404,'Kuis tidak ditemukan.');
    const t = importTemplate(r.rows[0].question_type);
    res.setHeader('Content-Type','text/csv; charset=utf-8'); res.setHeader('Content-Disposition',`attachment; filename="template-${r.rows[0].code.toLowerCase()}.csv"`); res.send('\uFEFF'+t);
  } catch(e) { next(e); }
});
app.post('/api/admin/quizzes/:id/import-preview', admin, importLimiter, imageUpload.single('file'), async (req,res,next) => {
  try {
    let type;
    if(req.params.id==='new' && req.body?.text) {
      type=String(req.body.questionType||'');
      if(!Object.hasOwn(typeNames,type)) return sendError(res,400,'Jenis soal tidak valid untuk pratinjau teks.');
    } else {
      const qr = await pool.query('SELECT question_type,status FROM quizzes WHERE id=$1',[req.params.id]);
      if(!qr.rows[0]) return sendError(res,404,'Kuis tidak ditemukan.');
      if(['closed','archived'].includes(qr.rows[0].status)) return sendError(res,409,'Kuis sudah ditutup; impor tidak tersedia.');
      type=String(req.body?.questionType || qr.rows[0].question_type);
      if(!Object.hasOwn(typeNames,type)) return sendError(res,400,'Jenis soal tidak valid untuk impor.');
    }
    let rows = [];
    if(req.file) {
      const ext = path.extname(req.file.originalname).toLowerCase();
      if(!['.csv','.xlsx','.xls'].includes(ext)) return sendError(res,400,'Format file harus CSV atau Excel (.xlsx/.xls).');
      const book = XLSX.read(req.file.buffer,{type:'buffer',cellDates:false});
      const first = book.SheetNames[0];
      if(!first) return sendError(res,400,'File tidak memiliki sheet.');
      rows = XLSX.utils.sheet_to_json(book.Sheets[first],{defval:'',raw:false});
    } else if(req.body?.text) {
      const parsed = parsePastedText(req.body.text,type);
      return res.json({ ...parsed, canImport:parsed.errors.length===0 && parsed.questions.length>0 });
    } else return sendError(res,400,'Pilih file atau masukkan teks soal terlebih dahulu.');
    if(!rows.length) return sendError(res,400,'Tidak ada baris soal dalam file.');
    const questions = []; const errors = [];
    rows.forEach((row,i)=>{ try { questions.push(parseImportRow(row,type,i)); } catch(e) { errors.push({row:i+2,message:e.message}); } });
    res.json({total:rows.length,questions:errors.length?[]:questions,errors,preview:rows.slice(0,50).map((r,i)=>({row:i+2,prompt:String(r.prompt??r.question??r.soal??'').slice(0,180)})),canImport:errors.length===0&&questions.length>0});
  } catch(e) { if(e instanceof multer.MulterError) return sendError(res,413,`File terlalu besar atau bermasalah. Batas unggah ${maxUploadMb} MB.`); next(e); }
});
app.post('/api/admin/quizzes/:id/import', admin, async (req,res,next) => {
  try {
    const result = await saveQuestions(req.params.id,req.body?.questions);
    await audit('questions_imported',{quizId:Number(req.params.id),count:result.count});
    res.json(result);
  } catch(e) { if(e.status) return sendError(res,e.status,e.message); return sendError(res,400,e.message || 'Impor gagal.'); }
});

app.post('/api/admin/media', admin, imageUpload.single('image'), async (req,res,next) => {
  try {
    if(!req.file) return sendError(res,400,'Pilih file gambar.');
    const allowed = ['image/jpeg','image/png','image/webp','image/gif'];
    if(!allowed.includes(req.file.mimetype)) return sendError(res,400,'Gambar harus JPG, PNG, WebP, atau GIF.');
    const id = crypto.randomUUID();
    await pool.query('INSERT INTO media_assets(id,mime_type,original_name,bytes) VALUES($1,$2,$3,$4)',[id,req.file.mimetype,path.basename(req.file.originalname).slice(0,200),req.file.buffer]);
    res.status(201).json({url:`/api/media/${id}`,id});
  } catch(e) { if(e instanceof multer.MulterError) return sendError(res,413,`Gambar maksimal ${maxUploadMb} MB.`); next(e); }
});
app.get('/api/media/:id', async (req,res,next) => {
  try {
    if(!/^[0-9a-f-]{36}$/i.test(req.params.id)) return sendError(res,404,'Gambar tidak ditemukan.');
    const r = await pool.query('SELECT mime_type,bytes FROM media_assets WHERE id=$1',[req.params.id]);
    if(!r.rows[0]) return sendError(res,404,'Gambar tidak ditemukan.');
    res.setHeader('Content-Type',r.rows[0].mime_type); res.setHeader('Cache-Control','public, max-age=86400'); res.send(r.rows[0].bytes);
  } catch(e) { next(e); }
});

app.post('/api/admin/backup/preview', admin, async (req,res) => {
  const b = req.body?.backup;
  if(!b || b.format!=='cryptclass-backup' || b.version!==1 || !Array.isArray(b.quizzes) || !Array.isArray(b.questions) || !Array.isArray(b.participants) || !Array.isArray(b.attempts) || !Array.isArray(b.audit_log) || !Array.isArray(b.media_assets)) return sendError(res,400,'File backup tidak cocok atau tidak lengkap.');
  res.json({valid:true,counts:{quizzes:b.quizzes.length,questions:b.questions.length,participants:b.participants.length,attempts:b.attempts.length,audit_log:b.audit_log.length,media_assets:b.media_assets.length},warning:'Pemulihan akan mengganti seluruh data kuis, peserta, jawaban, media, dan audit saat ini. PIN admin tidak diubah.'});
});
app.get('/api/admin/backup/download', admin, async (_req,res,next) => {
  try {
    const [quizzes,questions,participants,attempts,auditLog,media] = await Promise.all([
      pool.query('SELECT * FROM quizzes ORDER BY id'),pool.query('SELECT * FROM questions ORDER BY id'),
      pool.query('SELECT * FROM participants ORDER BY id'),pool.query('SELECT * FROM attempts ORDER BY id'),
      pool.query('SELECT * FROM audit_log ORDER BY id'),pool.query('SELECT id,mime_type,original_name,encode(bytes,\'base64\') AS base64 FROM media_assets ORDER BY id')
    ]);
    const backup = {format:'cryptclass-backup',version:1,created_at:new Date().toISOString(),quizzes:quizzes.rows,questions:questions.rows,participants:participants.rows,attempts:attempts.rows,audit_log:auditLog.rows,media_assets:media.rows};
    res.setHeader('Content-Type','application/json; charset=utf-8'); res.setHeader('Content-Disposition',`attachment; filename="cryptclass-backup-${new Date().toISOString().slice(0,10)}.json"`); res.send(JSON.stringify(backup));
  } catch(e) { next(e); }
});
app.post('/api/admin/backup/restore', admin, async (req,res,next) => {
  const b = req.body?.backup;
  if(req.body?.confirm!==true || !b || b.format!=='cryptclass-backup' || b.version!==1 || !Array.isArray(b.quizzes) || !Array.isArray(b.questions) || !Array.isArray(b.participants) || !Array.isArray(b.attempts) || !Array.isArray(b.audit_log) || !Array.isArray(b.media_assets)) return sendError(res,400,'Backup belum valid atau konfirmasi pemulihan belum diberikan.');
  if(b.quizzes.length>1000 || b.questions.length>100000 || b.participants.length>100000 || b.attempts.length>200000) return sendError(res,413,'Backup melebihi batas pemulihan aman.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('TRUNCATE TABLE quizzes RESTART IDENTITY CASCADE');
    await client.query('TRUNCATE TABLE audit_log RESTART IDENTITY');
    await client.query('TRUNCATE TABLE media_assets');
    for(const q of b.quizzes) await client.query('INSERT INTO quizzes(id,code,title,subject,description,class_name,quiz_date,teacher_name,question_type,status,created_at,updated_at,opened_at,closed_at,archived_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)',[q.id,q.code,q.title,q.subject,q.description,q.class_name,q.quiz_date,q.teacher_name,q.question_type,q.status,q.created_at,q.updated_at,q.opened_at,q.closed_at,q.archived_at]);
    for(const q of b.questions) await client.query('INSERT INTO questions(id,quiz_id,position,question_type,prompt,image_url,options,answer_key,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[q.id,q.quiz_id,q.position,q.question_type || 'single',q.prompt,q.image_url,JSON.stringify(q.options||[]),JSON.stringify(q.answer_key||{}),q.created_at,q.updated_at]);
    for(const p of b.participants) await client.query('INSERT INTO participants(id,quiz_id,display_name,session_token_hash,status,joined_at,last_seen_at) VALUES($1,$2,$3,$4,$5,$6,$7)',[p.id,p.quiz_id,p.display_name,p.session_token_hash,p.status,p.joined_at,p.last_seen_at]);
    for(const a of b.attempts) await client.query('INSERT INTO attempts(id,participant_id,attempt_number,answers,score,question_results,state,submitted_at,created_at,updated_at,active) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[a.id,a.participant_id,a.attempt_number,JSON.stringify(a.answers||{}),a.score,JSON.stringify(a.question_results||[]),a.state,a.submitted_at,a.created_at,a.updated_at,a.active]);
    for(const a of b.audit_log) await client.query('INSERT INTO audit_log(id,event,details,created_at) VALUES($1,$2,$3,$4)',[a.id,a.event,JSON.stringify(a.details||{}),a.created_at]);
    for(const m of b.media_assets) await client.query('INSERT INTO media_assets(id,mime_type,original_name,bytes) VALUES($1,$2,$3,decode($4,\'base64\'))',[m.id,m.mime_type,m.original_name,m.base64]);
    for(const [table,col] of [['quizzes','id'],['questions','id'],['participants','id'],['attempts','id'],['audit_log','id']]) await client.query(`SELECT setval(pg_get_serial_sequence('${table}','${col}'), COALESCE((SELECT MAX(${col}) FROM ${table}),1), EXISTS(SELECT 1 FROM ${table}))`);
    await client.query('COMMIT'); res.json({ok:true,message:'Backup dipulihkan. PIN admin tetap sama; sesi peserta lama mungkin tidak valid jika token mereka hilang.'});
  } catch(e) { await client.query('ROLLBACK'); next(e); } finally { client.release(); }
});

app.get('/api/admin/quizzes/:id/export', admin, async (req,res,next) => {
  try {
    const report = await getReport(req.params.id);
    const format = String(req.query.format || 'xlsx').toLowerCase();
    const reportType = String(req.query.report || 'all').toLowerCase();
    if(!['csv','xlsx','pdf'].includes(format)) return sendError(res,400,'Format ekspor harus CSV, XLSX, atau PDF.');
    if(!['scores','answers','questions','all'].includes(reportType)) return sendError(res,400,'Jenis laporan tidak valid.');
    const filenameBase = (report.quiz.code || 'kuis').toLowerCase();
    const scoreRows = report.participants.map(p=>({Nama:p.display_name,Status:p.status==='completed'?'Selesai':p.status==='locked'?'Terkunci':'Belum selesai',Percobaan:p.attempt_number??'',Nilai:p.score??'',Jawaban_Dikirim:p.attempt_state==='submitted'?'Ya':'Tidak'}));
    const questionRows = report.questionAnalysis.map(q=>({Nomor:q.position,Soal:q.prompt,Sample:q.sample_size,Salah:q.wrong_count,'Salah_%':q.wrong_pct,Kosong:q.blank_count,'Kosong_%':q.blank_pct,Parsial:q.partial_count}));
    const answerRows = [];
    for(const p of report.participants) for(const q of report.questions) {
      const answer = p.answers?.[String(q.id)];
      const st = p.question_results?.find(x=>Number(x.questionId)===Number(q.id));
      answerRows.push({Nama:p.display_name,StatusPeserta:p.status,Nomor:q.position,Soal:q.prompt,Jawaban:labelForAnswer(q,answer),StatusJawaban:st?.status||'unanswered',Poin:st?.points??0});
    }
    const book = XLSX.utils.book_new();
    if(format==='csv') {
      const source = reportType==='scores'?scoreRows:reportType==='questions'?questionRows:answerRows;
      const csv = XLSX.utils.sheet_to_csv(XLSX.utils.json_to_sheet(source));
      res.setHeader('Content-Type','text/csv; charset=utf-8');res.setHeader('Content-Disposition',`attachment; filename="${filenameBase}-${reportType}.csv"`);return res.send('\uFEFF'+csv);
    }
    if(format==='xlsx') {
      if(reportType==='scores'||reportType==='all') XLSX.utils.book_append_sheet(book,XLSX.utils.json_to_sheet(scoreRows), 'Nilai Peserta');
      if(reportType==='answers'||reportType==='all') XLSX.utils.book_append_sheet(book,XLSX.utils.json_to_sheet(answerRows), 'Jawaban');
      if(reportType==='questions'||reportType==='all') XLSX.utils.book_append_sheet(book,XLSX.utils.json_to_sheet(questionRows), 'Analisis Soal');
      const output = XLSX.write(book,{type:'buffer',bookType:'xlsx'});
      res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');res.setHeader('Content-Disposition',`attachment; filename="${filenameBase}-${reportType}.xlsx"`);return res.send(output);
    }
    res.setHeader('Content-Type','application/pdf');res.setHeader('Content-Disposition',`attachment; filename="${filenameBase}-${reportType}.pdf"`);
    const pdf = new PDFDocument({size:'A4',margin:40,bufferPages:true});pdf.pipe(res);
    pdf.fontSize(19).fillColor('#ef7d32').text('CRYPTCLASS — LAPORAN KUIS',{align:'left'});
    pdf.moveDown(0.35).fontSize(13).fillColor('#252033').text(report.quiz.title);
    pdf.fontSize(9).fillColor('#555').text(`${report.quiz.subject} | ${report.quiz.class_name} | Kode ${report.quiz.code} | Status ${statusNames[report.quiz.status]||report.quiz.status}`);
    pdf.moveDown().fontSize(11).fillColor('#252033').text(`Peserta ${report.stats.joined} · Selesai ${report.stats.completed} · Belum selesai ${report.stats.in_progress} · Terkunci ${report.stats.locked}`);
    if(report.stats.average!==null) pdf.text(`Nilai tertinggi ${report.stats.highest} · Terendah ${report.stats.lowest} · Rata-rata ${report.stats.average}`);
    const addTable = (heading, rows, keys) => {
      pdf.moveDown().fontSize(13).fillColor('#ef7d32').text(heading);
      pdf.moveDown(0.2);
      rows.forEach((row,i)=>{
        const txt = keys.map(k=>`${k}: ${String(row[k]??'—').replace(/\s+/g,' ').slice(0,260)}`).join('  |  ');
        if(pdf.y>740){pdf.addPage();}
        pdf.fontSize(8).fillColor('#252033').text(`${i+1}. ${txt}`,{width:510});pdf.moveDown(0.25);
      });
    };
    if(reportType==='scores'||reportType==='all') addTable('NILAI PESERTA',scoreRows,['Nama','Status','Percobaan','Nilai']);
    if(reportType==='answers'||reportType==='all') addTable('JAWABAN PER PESERTA',answerRows,['Nama','Nomor','Jawaban','StatusJawaban','Poin']);
    if(reportType==='questions'||reportType==='all') addTable('ANALISIS SOAL',questionRows,['Nomor','Soal','Sample','Salah','Salah_%','Kosong','Kosong_%','Parsial']);
    pdf.end();
  } catch(e) { next(e); }
});

app.post('/api/participant/state', participantInput, async (req,res,next) => {
  try {
    const pR = await pool.query('SELECT p.*,q.status AS quiz_status,q.updated_at AS quiz_updated_at,q.title,q.subject,q.description,q.class_name,q.quiz_date,q.teacher_name,q.code,q.question_type,q.closed_at FROM participants p JOIN quizzes q ON q.id=p.quiz_id WHERE p.id=$1',[req.participantId]);
    const p = pR.rows[0];
    if(!p || !safeEqual(sha256(req.participantToken),p.session_token_hash)) return sendError(res,401,'Sesi peserta tidak valid.');
    await pool.query('UPDATE participants SET last_seen_at=NOW() WHERE id=$1',[p.id]);
    const attemptR = await pool.query('SELECT * FROM attempts WHERE participant_id=$1 AND active=TRUE ORDER BY created_at DESC LIMIT 1',[p.id]);
    const a = attemptR.rows[0] || null;
    const qR = await pool.query('SELECT id,position,prompt,image_url,question_type,options FROM questions WHERE quiz_id=$1 ORDER BY position',[p.quiz_id]);
    const result = a && a.score !== null && a.score !== undefined ? {score:Number(a.score),statuses:a.question_results||[],submitted_at:a.submitted_at,state:a.state} : null;
    res.json({quiz:{...safeQuiz({...p,status:p.quiz_status}),updated_at:p.quiz_updated_at},participant:{id:Number(p.id),name:p.display_name,status:p.status},status:p.status,attemptId:a?Number(a.id):null,attemptNumber:a?.attempt_number||null,questions:qR.rows.map(publicQuestion),answers:a?.answers||{},result});
  } catch(e) { next(e); }
});

app.post('/api/join', joinLimiter, async (req,res,next) => {
  const code = String(req.body?.code || '').trim().toUpperCase();
  const name = cleanName(req.body?.name);
  if(!isValidCode(code) || name.length<1 || name.length>80) return sendError(res,400,'Masukkan kode kuis valid dan nama 1–80 karakter.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const qr = await client.query('SELECT * FROM quizzes WHERE code=$1',[code]);
    const quiz = qr.rows[0];
    if(!quiz || !['open','closed'].includes(quiz.status)) { await client.query('ROLLBACK'); return sendError(res,404,'Kuis tidak ditemukan, belum dibuka, atau sudah diarsipkan.'); }
    // A display name is not an identity. Resume only by the unguessable per-participant token;
    // otherwise create a new participant row, even when another participant has the same name.
    let token = String(req.body?.resumeToken || '');
    let p = null;
    if(token) {
      p = (await client.query('SELECT * FROM participants WHERE quiz_id=$1 AND session_token_hash=$2 FOR UPDATE',[quiz.id,sha256(token)])).rows[0] || null;
    }
    if(!p) {
      if(quiz.status!=='open') { await client.query('ROLLBACK'); return sendError(res,409,'Kuis sudah ditutup; peserta baru tidak bisa bergabung.'); }
      token = crypto.randomBytes(32).toString('hex');
      const pr = await client.query('INSERT INTO participants(quiz_id,display_name,session_token_hash) VALUES($1,$2,$3) RETURNING *',[quiz.id,name,sha256(token)]);
      p = pr.rows[0];
      await client.query("INSERT INTO attempts(participant_id,attempt_number,answers,state,active) VALUES($1,1,'{}'::jsonb,'in_progress',TRUE)",[p.id]);
    }
    await client.query('UPDATE participants SET last_seen_at=NOW() WHERE id=$1',[p.id]);
    const ar = await client.query('SELECT * FROM attempts WHERE participant_id=$1 AND active=TRUE ORDER BY created_at DESC LIMIT 1',[p.id]);
    const qs = await client.query('SELECT id,position,prompt,image_url,question_type,options FROM questions WHERE quiz_id=$1 ORDER BY position',[quiz.id]);
    await client.query('COMMIT');
    const attempt = ar.rows[0] || null;
    res.json({quiz:safeQuiz(quiz),participant:{id:Number(p.id),name:p.display_name,token},attemptId:attempt?Number(attempt.id):null,answers:attempt?.answers||{},status:p.status,questions:qs.rows.map(publicQuestion),result:attempt?.score===null||attempt?.score===undefined?null:{score:Number(attempt.score),statuses:attempt.question_results||[],submitted_at:attempt.submitted_at,state:attempt.state}});
  } catch(e) { await client.query('ROLLBACK'); if(e.code==='23505') return sendError(res,409,'Nama peserta sudah digunakan. Coba lagi atau hubungi admin.'); next(e); } finally { client.release(); }
});
app.post('/api/answer', participantInput, async (req,res,next) => {
  const {questionId,answer} = req.body || {};
  if(!questionId || !/^\d+$/.test(String(questionId))) return sendError(res,400,'ID soal tidak valid.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const pR = await client.query('SELECT p.*,q.status AS quiz_status FROM participants p JOIN quizzes q ON q.id=p.quiz_id WHERE p.id=$1 FOR UPDATE OF p',[req.participantId]);
    const p = pR.rows[0];
    if(!p || !safeEqual(sha256(req.participantToken),p.session_token_hash)) { await client.query('ROLLBACK'); return sendError(res,401,'Sesi peserta tidak valid. Masuk ulang menggunakan sesi di perangkat ini.'); }
    if(p.quiz_status!=='open'||p.status!=='in_progress') { await client.query('ROLLBACK'); return sendError(res,423,'Kuis sudah ditutup atau percobaan terkunci.'); }
    const q = await client.query('SELECT questions.id,questions.options,questions.question_type FROM questions WHERE questions.id=$1 AND questions.quiz_id=$2',[questionId,p.quiz_id]);
    if(!q.rows[0]) { await client.query('ROLLBACK'); return sendError(res,404,'Soal tidak ditemukan. Muat ulang kuis.'); }
    const checked = validateAnswer(q.rows[0].question_type, q.rows[0].options, answer);
    if(!checked.valid) { await client.query('ROLLBACK'); return sendError(res,400,checked.message); }
    const ar = await client.query('SELECT * FROM attempts WHERE participant_id=$1 AND active=TRUE FOR UPDATE',[p.id]);
    if(!ar.rows[0] || ar.rows[0].state!=='in_progress') { await client.query('ROLLBACK'); return sendError(res,423,'Percobaan tidak lagi aktif.'); }
    const answers = {...(ar.rows[0].answers || {}),[String(questionId)]:checked.value};
    await client.query('UPDATE attempts SET answers=$1,updated_at=NOW() WHERE id=$2',[JSON.stringify(answers),ar.rows[0].id]);
    await client.query('UPDATE participants SET last_seen_at=NOW() WHERE id=$1',[p.id]);
    await client.query('COMMIT'); res.json({ok:true,saved:'server',savedAt:new Date().toISOString()});
  } catch(e) { await client.query('ROLLBACK'); next(e); } finally { client.release(); }
});
app.post('/api/submit', participantInput, async (req,res,next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const pr = await client.query('SELECT p.*,q.status AS quiz_status FROM participants p JOIN quizzes q ON q.id=p.quiz_id WHERE p.id=$1 FOR UPDATE OF p',[req.participantId]);
    const p = pr.rows[0];
    if(!p || !safeEqual(sha256(req.participantToken),p.session_token_hash)) { await client.query('ROLLBACK'); return sendError(res,401,'Sesi peserta tidak valid.'); }
    const ar = await client.query('SELECT * FROM attempts WHERE participant_id=$1 AND active=TRUE FOR UPDATE',[p.id]);
    const a = ar.rows[0];
    if(!a) { await client.query('ROLLBACK'); return sendError(res,404,'Percobaan tidak ditemukan.'); }
    if(p.status==='completed' || a.state==='submitted') { await client.query('COMMIT'); return res.json({alreadySubmitted:true,score:Number(a.score||0),statuses:a.question_results||[]}); }
    if(p.quiz_status!=='open'||p.status!=='in_progress'||a.state!=='in_progress') { await client.query('ROLLBACK'); return sendError(res,423,'Kuis sudah ditutup; jawaban tidak dapat dikirim lagi.'); }
    const g = await gradeAttempt(client,p.quiz_id,a.answers||{},false);
    await client.query("UPDATE attempts SET score=$1,question_results=$2,state='submitted',submitted_at=NOW(),updated_at=NOW() WHERE id=$3",[g.score,JSON.stringify(g.results),a.id]);
    await client.query("UPDATE participants SET status='completed',last_seen_at=NOW() WHERE id=$1",[p.id]);
    await client.query('COMMIT'); res.json({score:g.score,statuses:g.results,submittedAt:new Date().toISOString()});
  } catch(e) { await client.query('ROLLBACK'); next(e); } finally { client.release(); }
});

app.use((err, _req, res, _next) => {
  if (res.headersSent) return;
  console.error(err.stack || err);
  const status = err.status && Number.isInteger(err.status) ? err.status : 500;
  res.status(status).json({error:status>=500?'Terjadi kesalahan server. Cek log aplikasi untuk detail.':err.message});
});

init().catch(e => { console.error('Gagal memulai CryptClass:', e.message); process.exit(1); });
