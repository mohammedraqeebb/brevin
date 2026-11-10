#!/usr/bin/env node
// brevin: install, switch on/off, log checks, report, and remove the Brevin skill
// for Claude Code and Codex. No dependencies. `brevin remove` undoes everything install did.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import readline from "node:readline";

const HOME = os.homedir();
const SCRIPT = fs.realpathSync(fileURLToPath(import.meta.url));
const PKG_DIR = path.resolve(path.dirname(SCRIPT), "..");
const SKILL_SRC = path.join(PKG_DIR, "skill", "SKILL.md");

const BREVIN_DIR = path.join(HOME, ".brevin");
const CONFIG = path.join(BREVIN_DIR, "config.json");
const PROFILE = path.join(BREVIN_DIR, "profile.md");
const LEDGER = path.join(BREVIN_DIR, "ledger.jsonl");
const BREVIN_SKILL = path.join(BREVIN_DIR, "SKILL.md"); // the copy Codex reads

const CLAUDE_DIR = path.join(HOME, ".claude");
const CLAUDE_SKILL_DIR = path.join(CLAUDE_DIR, "skills", "brevin");
const CLAUDE_SETTINGS = path.join(CLAUDE_DIR, "settings.json");

const CODEX_DIR = path.join(HOME, ".codex");
const CODEX_AGENTS = path.join(CODEX_DIR, "AGENTS.md");
const BLOCK_START = "<!-- brevin:start -->";
const BLOCK_END = "<!-- brevin:end -->";

// Look a program up on PATH, the way the shell would.
const onPath = (name) => {
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    const p = path.join(dir, name);
    try {
      fs.accessSync(p, fs.constants.X_OK);
      return p;
    } catch {}
  }
  return null;
};

// Full paths, so the hook works even when `brevin` isn't on the hook's PATH (nvm, app launches).
// Prefer node as found on PATH (e.g. /opt/homebrew/bin/node, which survives Node upgrades) over
// the exact version folder Node is running from. `|| true` keeps Claude Code quiet if it breaks.
const NODE = onPath("node") ?? process.execPath;
const HOOK_COMMAND = `"${NODE}" "${SCRIPT}" hook session-start 2>/dev/null || true`;
const isOurHook = (entry) =>
  entry?.hooks?.some((h) => typeof h.command === "string" && h.command.includes("brevin") && h.command.includes("hook session-start"));

// ---------- files ----------

const short = (p) => p.replace(HOME, "~");
const done = (msg) => console.log(`  ✓ ${msg}`);

const readText = (file) => {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
};

// Write to a temp file, then swap it in: a crash mid-write never leaves a half file.
function writeSafely(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.brevin-${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

// Missing file → {}. A file that exists but isn't valid JSON → stop; never overwrite it.
function readJsonStrict(file) {
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    throw new Error(`${short(file)} isn't valid JSON, so Brevin won't touch it. Fix the file and run this again.`);
  }
}

const config = () => {
  try {
    return { enabled: true, ...JSON.parse(fs.readFileSync(CONFIG, "utf8")) };
  } catch {
    return { enabled: true };
  }
};
const setConfig = (patch) => writeSafely(CONFIG, JSON.stringify({ ...config(), ...patch }, null, 2) + "\n");

// The default mode lives in the profile, where `/brevin always <mode>` writes it.
const profileMode = () => readText(PROFILE).match(/^Mode:\s*(learn|quick|outsource)\b/im)?.[1]?.toLowerCase() ?? "learn";

// ---------- Claude Code ----------

function addClaudeHook() {
  const settings = readJsonStrict(CLAUDE_SETTINGS);
  settings.hooks ??= {};
  const list = (settings.hooks.SessionStart ?? []).filter((e) => !isOurHook(e)); // replaces an older Brevin hook
  list.push({ hooks: [{ type: "command", command: HOOK_COMMAND }] });
  settings.hooks.SessionStart = list;
  writeSafely(CLAUDE_SETTINGS, JSON.stringify(settings, null, 2) + "\n");
}

function removeClaudeHook() {
  if (!fs.existsSync(CLAUDE_SETTINGS)) return false;
  const settings = readJsonStrict(CLAUDE_SETTINGS);
  const list = settings.hooks?.SessionStart;
  if (!Array.isArray(list) || !list.some(isOurHook)) return false;
  settings.hooks.SessionStart = list.filter((e) => !isOurHook(e));
  if (settings.hooks.SessionStart.length === 0) delete settings.hooks.SessionStart;
  if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
  writeSafely(CLAUDE_SETTINGS, JSON.stringify(settings, null, 2) + "\n");
  return true;
}

const hasClaudeHook = () => {
  try {
    return (readJsonStrict(CLAUDE_SETTINGS).hooks?.SessionStart ?? []).some(isOurHook);
  } catch {
    return false;
  }
};

// ---------- Codex ----------

const hasCodex = () => fs.existsSync(CODEX_DIR);

const codexBlock = () =>
  [
    BLOCK_START,
    "## Brevin",
    `Brevin is on. At the start of every session, read \`${short(BREVIN_SKILL)}\` and follow it,`,
    `using \`${short(PROFILE)}\` as the person's profile. If it doesn't exist, start by asking the`,
    "3 getting-to-know-you questions in the skill.",
    BLOCK_END,
  ].join("\n");

function stripCodexBlock(text) {
  const re = new RegExp(`${BLOCK_START}[\\s\\S]*?${BLOCK_END}`, "g");
  return text.replace(re, "").replace(/\n{3,}/g, "\n\n").trim();
}

function addCodexBlock() {
  const rest = stripCodexBlock(readText(CODEX_AGENTS));
  writeSafely(CODEX_AGENTS, (rest ? rest + "\n\n" : "") + codexBlock() + "\n");
}

function removeCodexBlock() {
  const text = readText(CODEX_AGENTS);
  if (!text.includes(BLOCK_START)) return false;
  const rest = stripCodexBlock(text);
  if (rest) writeSafely(CODEX_AGENTS, rest + "\n");
  else fs.rmSync(CODEX_AGENTS);
  return true;
}

// ---------- switching on and off ----------

function switchOn({ quiet } = {}) {
  // Check settings first, so a broken settings.json stops everything before any change.
  readJsonStrict(CLAUDE_SETTINGS);

  writeSafely(path.join(CLAUDE_SKILL_DIR, "SKILL.md"), fs.readFileSync(SKILL_SRC, "utf8"));
  if (!quiet) done(`Claude Code skill   ${short(path.join(CLAUDE_SKILL_DIR, "SKILL.md"))}`);

  addClaudeHook();
  if (!quiet) done(`Starts with Claude  ${short(CLAUDE_SETTINGS)} (a SessionStart hook)`);

  writeSafely(BREVIN_SKILL, fs.readFileSync(SKILL_SRC, "utf8"));
  setConfig({ enabled: true });
  if (!quiet) done(`Your folder         ${short(BREVIN_DIR)}/ (your profile and check log, plain text)`);

  if (hasCodex()) {
    addCodexBlock();
    if (!quiet) done(`Starts with Codex   ${short(CODEX_AGENTS)} (a marked Brevin block)`);
  }
}

// Off means off: no skill for Claude to load, no hook, no Codex block. The profile and log stay.
function switchOff() {
  const removed = [];
  if (fs.existsSync(CLAUDE_SKILL_DIR)) {
    fs.rmSync(CLAUDE_SKILL_DIR, { recursive: true, force: true });
    removed.push(`Removed ${short(CLAUDE_SKILL_DIR)}`);
  }
  if (removeClaudeHook()) removed.push(`Removed the startup hook from ${short(CLAUDE_SETTINGS)}`);
  if (removeCodexBlock()) removed.push(`Removed the Brevin block from ${short(CODEX_AGENTS)}`);
  if (fs.existsSync(BREVIN_DIR)) setConfig({ enabled: false });
  return removed;
}

const tools = () => "Claude Code" + (hasCodex() ? " or Codex" : "");

function install() {
  console.log("\n  Brevin: understand what you build\n");
  switchOn();
  console.log(`\n  Brevin is on in every ${tools()} session. Say anything and it starts.`);
  console.log("  Switch off: brevin off   ·   Undo everything: brevin remove\n");
  offerToStart();
}

// Run by npm right after `npm i -g brevin`, so one command sets everything up.
// Never fails the npm install: on any problem it says to run `brevin install` instead.
function postinstall() {
  if (process.env.npm_config_global !== "true") return;
  try {
    switchOn({ quiet: true });
    console.log("Brevin is on. Open Claude Code in any project and say hi.");
  } catch (err) {
    console.log(`Brevin isn't set up yet (${err.message}). Run: brevin install`);
  }
}

// Open Claude Code with a first "hi" already sent, so Brevin starts right away.
function offerToStart() {
  const claude = onPath("claude");
  if (!claude || !process.stdin.isTTY || !process.stdout.isTTY) return;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question("  Start now in this folder? (Y/n) ", (answer) => {
    rl.close();
    if (/^n/i.test(answer.trim())) return;
    spawn(claude, ["hi"], { stdio: "inherit" }).on("exit", (code) => process.exit(code ?? 0));
  });
}

function on() {
  switchOn({ quiet: true });
  console.log(`\n  Brevin is on. It starts with your next ${tools()} session.\n`);
}

function off() {
  switchOff();
  console.log("\n  Brevin is off. Your profile and log are kept. Turn it back on: brevin on\n");
}

function remove() {
  console.log("\n  Removing Brevin\n");
  for (const line of switchOff()) done(line);
  if (fs.existsSync(BREVIN_SKILL)) fs.rmSync(BREVIN_SKILL);
  console.log(`\n  Your profile and log are still in ${short(BREVIN_DIR)}/. Delete that folder to remove them too.`);
  console.log("  Then: npm uninstall -g brevin\n");
}

function status() {
  const installed = fs.existsSync(CLAUDE_SKILL_DIR) && hasClaudeHook();
  console.log(`\n  Brevin is ${installed && config().enabled ? "on" : "off"} · default mode: ${profileMode()}`);
  console.log(`  Claude Code: ${installed ? "on" : "off"}`);
  if (hasCodex()) console.log(`  Codex: ${readText(CODEX_AGENTS).includes(BLOCK_START) ? "on" : "off"}`);
  console.log(`  Profile: ${fs.existsSync(PROFILE) ? short(PROFILE) : "none yet (Brevin asks 3 getting-to-know-you questions on first use)"}\n`);
}

// ---------- the startup hook ----------

const readStdin = () => {
  if (process.stdin.isTTY) return "";
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
};

// Claude Code adds this to the session. Short on purpose: the full skill loads only when
// real work begins. On a resume or after compaction it doesn't reset the mode or greet again.
function hookSessionStart() {
  if (!config().enabled) return;
  let source = "startup";
  try {
    source = JSON.parse(readStdin() || "{}").source ?? "startup";
  } catch {}

  const mode = profileMode();
  const lines = [];
  if (source === "resume" || source === "compact") {
    lines.push(
      `Brevin is still on. Keep the mode already chosen in this conversation (default: ${mode}),`,
      `and load the "brevin" skill again before the next building, fixing or planning work.`,
    );
  } else {
    lines.push(
      `Brevin is on (mode: ${mode}). Before your first reply that involves building, fixing,`,
      `changing or planning code, load the "brevin" skill and follow it for the rest of the session.`,
    );
    if (!fs.existsSync(PROFILE)) {
      lines.push(
        "This person is new to Brevin (no profile yet). In your first reply, before anything else, greet them",
        "as Brevin and ask the 3 getting-to-know-you questions from the skill (section 1), one at a time.",
      );
    }
  }
  process.stdout.write(lines.join("\n") + "\n");
}

// ---------- the check log ----------

const RESULTS = new Set(["right", "partly", "wrong", "skipped"]);
const FIELDS = ["topic", "concept", "stakes", "kind", "mode", "question", "answer", "result"];

function log() {
  const raw = readStdin().trim() || process.argv[3] || "";
  let entry;
  try {
    entry = JSON.parse(raw);
  } catch {
    throw new Error("brevin log expects one JSON object on stdin.");
  }
  if (!RESULTS.has(entry.result)) throw new Error(`result must be one of: ${[...RESULTS].join(", ")}.`);
  const line = { t: new Date().toISOString(), project: path.basename(process.cwd()) };
  for (const k of FIELDS) {
    if (entry[k] != null) line[k] = String(entry[k]).slice(0, k === "answer" || k === "question" ? 300 : 80);
  }
  fs.mkdirSync(BREVIN_DIR, { recursive: true });
  fs.appendFileSync(LEDGER, JSON.stringify(line) + "\n");
  console.log(`Logged: ${line.concept ?? line.topic ?? "check"} → ${line.result}`);
}

// ---------- the report ----------

const WEIGHT = { high: 3, medium: 2, low: 1 };
const POINTS = { right: 1, partly: 0.5, wrong: 0 };

function report() {
  const project = path.basename(process.cwd());
  const since = Date.now() - 30 * 24 * 3600 * 1000;
  const rows = readText(LEDGER)
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter((r) => r && r.project === project && Date.parse(r.t) >= since);

  if (rows.length === 0) {
    console.log(`\n  ${project} · last 30 days: no checks yet.\n`);
    return;
  }
  const answered = rows.filter((r) => r.result in POINTS);
  const skipped = rows.length - answered.length;
  let got = 0;
  let max = 0;
  const byConcept = new Map();
  for (const r of answered) {
    const w = WEIGHT[r.stakes] ?? 2;
    got += w * POINTS[r.result];
    max += w;
    const key = r.concept || r.topic || "other";
    const c = byConcept.get(key) ?? { got: 0, n: 0 };
    c.got += POINTS[r.result];
    c.n += 1;
    byConcept.set(key, c);
  }
  const pct = max ? Math.round((got / max) * 100) : 0;
  const weakest = [...byConcept.entries()]
    .filter(([, c]) => c.got / c.n < 1)
    .sort((a, b) => a[1].got / a[1].n - b[1].got / b[1].n)
    .slice(0, 3)
    .map(([k]) => k);

  console.log(`\n  ${project} · last 30 days`);
  console.log(`  Answered ${answered.length} of ${rows.length} checks (${skipped} skipped) · understood ${pct}% of those answered`);
  if (weakest.length) console.log(`  Weakest: ${weakest.join(" · ")}`);
  console.log("");
}

// ---------- main ----------

const help = () =>
  console.log(`
  brevin install   set up Brevin for Claude Code (and Codex, if found); on by default
  brevin off       switch Brevin off (your profile and log are kept)
  brevin on        switch it back on
  brevin status    show whether it's on
  brevin report    this project's checks over the last 30 days
  brevin remove    undo everything install did
`);

const [cmd, arg] = process.argv.slice(2);
try {
  switch (cmd) {
    case "install": install(); break;
    case "postinstall": postinstall(); break;
    case "on": on(); break;
    case "off": off(); break;
    case "status": status(); break;
    case "report": report(); break;
    case "log": log(); break;
    case "remove": case "uninstall": remove(); break;
    case "hook": if (arg === "session-start") hookSessionStart(); break;
    default: help();
  }
} catch (err) {
  if (cmd === "hook" || cmd === "postinstall") process.exit(0); // a hook must never break a Claude Code session
  console.error(`\n  brevin: ${err.message}\n`);
  process.exit(1);
}
