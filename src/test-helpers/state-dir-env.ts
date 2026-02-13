type StateDirEnvSnapshot = {
  handsStateDir: string | undefined;
  clawdbotStateDir: string | undefined;
};

export function snapshotStateDirEnv(): StateDirEnvSnapshot {
  return {
    handsStateDir: process.env.HANDS_STATE_DIR,
    clawdbotStateDir: process.env.CLAWDBOT_STATE_DIR,
  };
}

export function restoreStateDirEnv(snapshot: StateDirEnvSnapshot): void {
  if (snapshot.handsStateDir === undefined) {
    delete process.env.HANDS_STATE_DIR;
  } else {
    process.env.HANDS_STATE_DIR = snapshot.handsStateDir;
  }
  if (snapshot.clawdbotStateDir === undefined) {
    delete process.env.CLAWDBOT_STATE_DIR;
  } else {
    process.env.CLAWDBOT_STATE_DIR = snapshot.clawdbotStateDir;
  }
}

export function setStateDirEnv(stateDir: string): void {
  process.env.HANDS_STATE_DIR = stateDir;
  delete process.env.CLAWDBOT_STATE_DIR;
}
