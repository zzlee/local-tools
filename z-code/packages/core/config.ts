import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

export const CONFIG_PATH = path.join(os.homedir(), ".config", "z-code", "config.json");

export interface Config {
  gemini_api_key?: string;
  gemini_model?: string;
  [key: string]: any;
}

export async function loadConfig(): Promise<Config> {
  try {
    const content = await fs.readFile(CONFIG_PATH, "utf8");
    return JSON.parse(content);
  } catch (e) {
    return {};
  }
}
