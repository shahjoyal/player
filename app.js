require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));
app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (err) {
    res.status(500).json({ error: "Database connection failed" });
  }
});

// ─── MONGODB MODELS ───────────────────────────────────────────────────────────

const GameStateSchema = new mongoose.Schema({
  key: { type: String, default: 'main', unique: true },
  phase: { type: String, default: 'lobby' }, // lobby | buzzer | scratch | ended
  currentRound: { type: Number, default: 1 },
  totalRounds: { type: Number, default: 5 },
  buzzerWinnerId: { type: String, default: null },
  buzzerWinnerName: { type: String, default: null },
  buzzerLockedAt: { type: Date, default: null },
  scratchRevealedAt: { type: Date, default: null },
  giftImageUrl: { type: String, default: null },
  compatQuestions: { type: [String], default: [] },
  compatPair: { type: mongoose.Schema.Types.Mixed, default: {} }, // { player1: name, player2: name }
  compatCurrentQ: { type: Number, default: 0 },
  compatAnswers: { type: mongoose.Schema.Types.Mixed, default: {} },
  raceQuestions: { type: mongoose.Schema.Types.Mixed, default: [] },
  racePair: { type: mongoose.Schema.Types.Mixed, default: {} },
  raceCurrentQ: { type: Number, default: 0 },
  raceStatus: { type: String, default: 'idle' },
  raceAnswers: { type: mongoose.Schema.Types.Mixed, default: {} },
  raceScores: { type: mongoose.Schema.Types.Mixed, default: {} },
  glassPair: { type: mongoose.Schema.Types.Mixed, default: {} },
  glassRound: { type: Number, default: 1 },
  glassTotalRounds: { type: Number, default: 2 },
  glassStatus: { type: String, default: 'idle' },
  glassHiddenIn: { type: Number, default: null },
  glassGuess: { type: Number, default: null },
  glassScores: { type: mongoose.Schema.Types.Mixed, default: {} },
  hintQuestions: { type: mongoose.Schema.Types.Mixed, default: [] },
  hintPair: { type: mongoose.Schema.Types.Mixed, default: {} },
  hintCurrentQ: { type: Number, default: 0 },
  hintStatus: { type: String, default: 'idle' },
  hintAnswer: { type: String, default: '' },
  hintGuess: { type: String, default: '' },
  hintRevealed: { type: Number, default: 0 },
  hintScores: { type: mongoose.Schema.Types.Mixed, default: {} },
  wsFoundWords: { type: mongoose.Schema.Types.Mixed, default: {} },
  wsStatus: { type: String, default: 'idle' },
  wsScores: { type: mongoose.Schema.Types.Mixed, default: {} },
  updatedAt: { type: Date, default: Date.now }
});

const PlayerSchema = new mongoose.Schema({
  name: { type: String, required: true },
  sessionId: { type: String, required: true, unique: true },
  score: { type: Number, default: 0 },
  buzzerPressedRound: { type: Number, default: null }, // which round they pressed
  buzzerPressedAt: { type: Date, default: null },
  hasScratched: { type: Boolean, default: false },
  scratchedAt: { type: Date, default: null },
  letterFallDone: { type: Boolean, default: false },
  letterFallTime: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now }
});

const GameState = mongoose.model('GameState', GameStateSchema);
const Player = mongoose.model('Player', PlayerSchema);

// ─── DB CONNECT ───────────────────────────────────────────────────────────────
// mongoose.connect(process.env.MONGO_URI)
//   .then(async () => {
//     console.log('✅ MongoDB connected');
//     // Ensure a game state doc exists
//     await GameState.findOneAndUpdate(
//       { key: 'main' },
//       { $setOnInsert: { key: 'main' } },
//       { upsert: true, new: true }
//     );
//   })
//   .catch(err => console.error('MongoDB error:', err));/


const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error("❌ MONGO_URI is missing in .env");
  process.exit(1);
}

let isConnected = false;

async function connectDB() {
  if (isConnected) return;

  try {
    const conn = await mongoose.connect(MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    isConnected = true;
    console.log("✅ MongoDB connected");

    // Ensure game state exists
    await GameState.findOneAndUpdate(
      { key: 'main' },
      { $setOnInsert: { key: 'main' } },
      { upsert: true, new: true }
    );

  } catch (err) {
    console.error("❌ MongoDB connection failed:", err);
    throw err;
  }
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────
async function getState() {
  return GameState.findOne({ key: 'main' });
}

// ─── ROUTES ───────────────────────────────────────────────────────────────────

// GET /api/state — full game state + player list
app.get('/api/state', async (req, res) => {
  try {
    const state = await getState();
    const players = await Player.find().sort({ score: -1, createdAt: 1 });
    res.json({ state, players });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/join — register or return existing player
app.post('/api/join', async (req, res) => {
  try {
    const { name, sessionId } = req.body;
    if (!name || !sessionId) return res.status(400).json({ error: 'Name and sessionId required' });

    // Check if session already exists
    let player = await Player.findOne({ sessionId });
    if (player) {
      // Update name if changed
      player.name = name.trim();
      await player.save();
      return res.json({ success: true, player });
    }

    // Check name uniqueness in current session
    const existing = await Player.findOne({ name: name.trim() });
    if (existing) return res.status(400).json({ error: 'Name already taken! Pick another.' });

    player = await Player.create({ name: name.trim(), sessionId });
    res.json({ success: true, player });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/buzzer — press the buzzer
app.post('/api/buzzer', async (req, res) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId) return res.status(400).json({ error: 'sessionId required' });

    const state = await getState();
    if (state.phase !== 'buzzer') return res.status(400).json({ error: 'Not in buzzer phase' });
    if (state.buzzerWinnerId) return res.status(400).json({ error: 'Buzzer already claimed', winner: state.buzzerWinnerName });

    const player = await Player.findOne({ sessionId });
    if (!player) return res.status(404).json({ error: 'Player not found' });

    // Check if this player already buzzed this round
    if (player.buzzerPressedRound === state.currentRound) {
      return res.status(400).json({ error: 'Already buzzed this round' });
    }

    // Lock buzzer
    const now = new Date();
    await GameState.updateOne({ key: 'main' }, {
      buzzerWinnerId: player._id.toString(),
      buzzerWinnerName: player.name,
      buzzerLockedAt: now,
      updatedAt: now
    });

    await Player.updateOne({ sessionId }, {
      buzzerPressedRound: state.currentRound,
      buzzerPressedAt: now
    });

    res.json({ success: true, isWinner: true, player });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/hint-answer
app.post('/api/hint-answer', async (req, res) => {
  try {
    const { sessionId, answer } = req.body;
    const state = await getState();
    if (state.phase !== 'hint' || state.hintStatus !== 'answering') return res.status(400).json({ error: 'Not answering phase' });
    const player = await Player.findOne({ sessionId });
    if (!player || player.name !== state.hintPair.player1) return res.status(403).json({ error: 'Not the answerer' });
    await GameState.updateOne({ key: 'main' }, { hintAnswer: (answer || '').trim(), updatedAt: new Date() });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/hint-guess
app.post('/api/hint-guess', async (req, res) => {
  try {
    const { sessionId, guess } = req.body;
    const state = await getState();
    if (state.phase !== 'hint' || state.hintStatus !== 'guessing') return res.status(400).json({ error: 'Not guessing phase' });
    const player = await Player.findOne({ sessionId });
    if (!player || player.name !== state.hintPair.player2) return res.status(403).json({ error: 'Not the guesser' });
    await GameState.updateOne({ key: 'main' }, { hintGuess: (guess || '').trim(), updatedAt: new Date() });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});


// POST /api/ws-found — player submits a found word
app.post('/api/ws-found', async (req, res) => {
  try {
    const { sessionId, word, cells } = req.body;
    const state = await getState();
    if (state.phase !== 'wordsearch' || state.wsStatus !== 'playing')
      return res.status(400).json({ error: 'Game not active' });
    const player = await Player.findOne({ sessionId });
    if (!player) return res.status(404).json({ error: 'Player not found' });
    const TARGET_WORDS = ['JOYAL','NISARG','NEELAM','CHIRAG','PRAFUL','PREMILA','CNJN'];
    const w = (word || '').toUpperCase().trim();
    if (!TARGET_WORDS.includes(w)) return res.json({ correct: false, message: 'Not a target word' });
    const found = state.wsFoundWords || {};
    if (found[w]) return res.json({ correct: false, alreadyFound: true, message: 'Already found!' });
    const GRID = [["Z","D","O","C","E","Y","H","V","X","V","M","Z","R"],["N","J","N","C","L","C","Z","M","A","I","R","D","O"],["L","V","X","V","I","S","N","E","E","L","A","M","M"],["U","P","A","L","I","M","E","R","P","L","J","D","V"],["H","R","P","A","T","R","K","T","H","O","U","C","U"],["O","A","W","J","U","N","D","E","Y","B","B","C","J"],["P","F","D","D","H","R","E","A","M","G","O","H","L"],["V","U","X","W","R","N","L","S","X","R","X","I","E"],["N","L","U","D","P","T","N","I","B","A","W","R","L"],["G","O","O","H","L","D","V","L","R","S","U","A","L"],["B","M","I","G","D","O","C","V","G","I","U","G","U"],["T","A","B","Z","K","H","E","Z","S","N","G","C","Y"],["R","G","S","G","H","K","Y","E","Z","T","A","I","E"]];
    const spelled = (cells || []).map(([r,c]) => GRID[r] && GRID[r][c] ? GRID[r][c] : '').join('');
    if (spelled !== w && spelled !== w.split('').reverse().join(''))
      return res.json({ correct: false, message: 'Incorrect selection' });
    found[w] = { playerName: player.name, cells };
    const scores = state.wsScores || {};
    scores[player.name] = (scores[player.name] || 0) + 1;
    await GameState.updateOne({ key: 'main' }, { wsFoundWords: found, wsScores: scores, updatedAt: new Date() });
    res.json({ correct: true, playerName: player.name, word: w });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Serve index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// const PORT = process.env.PORT_PLAYER || 3001;
// app.listen(PORT, () => console.log(`🎮 Player app running on port ${PORT}`));

module.exports = app;