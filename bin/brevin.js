#!/usr/bin/env node
// brevin: install, switch on/off, and remove the Brevin skill for Claude Code and Codex.
// No dependencies. Everything it writes is listed when it runs, and `brevin remove` undoes it.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HOME = os.homedir();
const PKG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKILL_SRC = path.join(PKG_DIR, "skill", "SKILL.md");

const BREVIN_DIR = path.join(HOME, ".brevin");
const CONFIG = path.join(BREVIN_DIR, "config.json");
const PROFILE = path.join(BREVIN_DIR, "profile.md");
const BREVIN_SKILL = path.join(BREVIN_DIR, "SKILL.md"); // the copy Codex reads

const CLAUDE_DIR = path.join(HOME, ".claude");
const CLAUDE_SKILL_DIR = path.join(CLAUDE_DIR, "skills", "brevin");
const CLAUDE_SETTINGS = path.join(CLAUDE_DIR, "settings.json");

const CODEX_DIR = path.join(HOME, ".codex");
const CODEX_AGENTS = path.join(CODEX_DIR, "AGENTS.md");

// The startup hook. `|| true` keeps Claude Code quiet if brevin was uninstalled by hand.
const HOOK_COMMAND = "brevin hook session-start 2>/dev/null || true";
const BLOCK_START = "<!-- brevin:start -->";
const BLOCK_END = "<!-- brevin:end -->";

// ---------- small helpers ----------

const readJson = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
};
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
};
const readText = (file) => {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
};
const copy = (from, to) => {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
};
const short = (p) => p.replace(HOME, "~");
const done = (msg) => console.log(`  ✓ ${msg}`);

const config = () => readJson(CONFIG, { enabled: true, mode: "learn" });
const setConfig = (patch) => writeJson(CONFIG, { ...config(), ...patch });

// ---------- Claude Code: the SessionStart hook in settings.json ----------

const isOurHook = (entry) => entry?.hooks?.some((h) => h.command === HOOK_COMMAND);

function addClaudeHook() {
  const settings = readJson(CLAUDE_SETTINGS, {});
  settings.hooks ??= {};
  settings.hooks.SessionStart ??= [];
  if (!settings.hooks.SessionStart.some(isOurHook)) {
    settings.hooks.SessionStart.push({ hooks: [{ type: "command", command: HOOK_COMMAND }] });
  }
  writeJson(CLAUDE_SETTINGS, settings);
}

function removeClaudeHook() {
  if (!fs.existsSync(CLAUDE_SETTINGS)) return false;
  const settings = readJson(CLAUDE_SETTINGS, null);
  const list = settings?.hooks?.SessionStart;
  if (!Array.isArray(list) || !list.some(isOurHook)) return false;
  settings.hooks.SessionStart = list.filter((e) => !isOurHook(e));
  if (settings.hooks.SessionStart.length === 0) delete settings.hooks.SessionStart;
  if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
  writeJson(CLAUDE_SETTINGS, settings);
  return true;
}

// ---------- Codex: a marked block in ~/.codex/AGENTS.md ----------

const codexBlock = () =>
  [
    BLOCK_START,
    "## Brevin",
    `Brevin is on. At the start of every session, read \`${short(BREVIN_SKILL)}\` and follow it,`,
    `using \`${short(PROFILE)}\` as the person's profile (if it doesn't exist, start by asking the 3 getting-to-know-you questions in the skill).`,
    "Codex has no per-helper models: treat the Model column in plans as a recommendation.",
    "The person switches this off with `brevin off`.",
    BLOCK_END,
  ].join("\n");

function stripCodexBlock(text) {
  const re = new RegExp(`\\n*${BLOCK_START}[\\s\\S]*?${BLOCK_END}\\n*`, "g");
  return text.replace(re, "\n").replace(/^\n+/, "");
}

function addCodexBlock() {
  const rest = stripCodexBlock(readText(CODEX_AGENTS)).trimEnd();
  fs.mkdirSync(CODEX_DIR, { recursive: true });
  fs.writeFileSync(CODEX_AGENTS, (rest ? rest + "\n\n" : "") + codexBlock() + "\n");
}

function removeCodexBlock() {
  const text = readText(CODEX_AGENTS);
  if (!text.includes(BLOCK_START)) return false;
  const rest = stripCodexBlock(text).trimEnd();
  if (rest) fs.writeFileSync(CODEX_AGENTS, rest + "\n");
  else fs.rmSync(CODEX_AGENTS);
  return true;
}

const hasCodex = () => fs.existsSync(CODEX_DIR);

// ---------- commands ----------

function install() {
  console.log("\n  Brevin: understand what you build\n");

  copy(SKILL_SRC, path.join(CLAUDE_SKILL_DIR, "SKILL.md"));
  done(`Claude Code skill   ${short(path.join(CLAUDE_SKILL_DIR, "SKILL.md"))}`);

  addClaudeHook();
  done(`Starts with Claude  ${short(CLAUDE_SETTINGS)} (a SessionStart hook)`);

  copy(SKILL_SRC, BREVIN_SKILL);
  setConfig({ enabled: true });
  done(`Your folder         ${short(BREVIN_DIR)}/ (profile + log, plain text, stays on this computer)`);

  if (hasCodex()) {
    addCodexBlock();
    done(`Starts with Codex   ${short(CODEX_AGENTS)} (a marked Brevin block)`);
  }

  console.log("\n  Brevin is on. Open Claude Code" + (hasCodex() ? " or Codex" : "") + " in any project and say hi.");
  console.log("  Switch off: brevin off   ·   Undo everything: brevin remove\n");
}

function on() {
  setConfig({ enabled: true });
  if (hasCodex()) addCodexBlock();
  console.log("\n  Brevin is on. It starts with your next Claude Code" + (hasCodex() ? " or Codex" : "") + " session.\n");
}

function off() {
  setConfig({ enabled: false });
  removeCodexBlock();
  console.log("\n  Brevin is off. Your profile and log are kept. Turn it back on: brevin on\n");
}

function remove() {
  console.log("\n  Removing Brevin\n");
  if (fs.existsSync(CLAUDE_SKILL_DIR)) {
    fs.rmSync(CLAUDE_SKILL_DIR, { recursive: true, force: true });
    done(`Removed ${short(CLAUDE_SKILL_DIR)}`);
  }
  if (removeClaudeHook()) done(`Removed the startup hook from ${short(CLAUDE_SETTINGS)}`);
  if (removeCodexBlock()) done(`Removed the Brevin block from ${short(CODEX_AGENTS)}`);
  if (fs.existsSync(BREVIN_SKILL)) fs.rmSync(BREVIN_SKILL);
  setConfig({ enabled: false });
  console.log(`\n  Your profile and log are still in ${short(BREVIN_DIR)}/. Delete that folder to remove them too.`);
  console.log("  Then: npm uninstall -g brevin\n");
}

function status() {
  const c = config();
  const settings = readJson(CLAUDE_SETTINGS, {});
  const hook = (settings.hooks?.SessionStart ?? []).some(isOurHook);
  console.log(`\n  Brevin is ${c.enabled ? "on" : "off"} · default mode: ${c.mode}`);
  console.log(`  Claude Code: ${hook && fs.existsSync(CLAUDE_SKILL_DIR) ? "installed" : "not installed"}`);
  if (hasCodex()) console.log(`  Codex: ${readText(CODEX_AGENTS).includes(BLOCK_START) ? "on" : "off"}`);
  console.log(`  Profile: ${fs.existsSync(PROFILE) ? short(PROFILE) : "none yet (Brevin asks 3 getting-to-know-you questions on first use)"}\n`);
}

// What Claude Code adds to the start of every session. Short on purpose: the full skill
// only loads when real work begins, so an idle session costs a few dozen tokens.
function hookSessionStart() {
  const c = config();
  if (!c.enabled) return;
  const lines = [
    `Brevin is on (default mode: ${c.mode}). Before your first reply that involves building, fixing,`,
    `changing or planning code, load the "brevin" skill and follow it for the rest of the session.`,
  ];
  if (!fs.existsSync(PROFILE)) {
    lines.push(
      "This person is new to Brevin (no profile yet). In your first reply, before anything else, greet them",
      "as Brevin and ask the 3 getting-to-know-you questions from the skill (section 1), one at a time.",
    );
  }
  lines.push("The person can switch Brevin off with `brevin off` in a terminal.");
  process.stdout.write(lines.join("\n") + "\n");
}

const help = () =>
  console.log(`
  brevin install   set up Brevin for Claude Code (and Codex, if found); on by default
  brevin off       switch Brevin off (your profile and log are kept)
  brevin on        switch it back on
  brevin status    show what's installed and whether it's on
  brevin remove    undo everything install did
`);

const [cmd, arg] = process.argv.slice(2);
try {
  switch (cmd) {
    case "install": install(); break;
    case "on": on(); break;
    case "off": off(); break;
    case "status": status(); break;
    case "remove": case "uninstall": remove(); break;
    case "hook": if (arg === "session-start") hookSessionStart(); break;
    default: help();
  }
} catch (err) {
  // A hook must never break a Claude Code session.
  if (cmd === "hook") process.exit(0);
  console.error(`\n  brevin: ${err.message}\n`);
  process.exit(1);
}
