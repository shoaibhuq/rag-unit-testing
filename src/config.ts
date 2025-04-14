import fs from 'fs';
import path from 'path';

export interface Config {
  analyze: {
    includedFiles: string[];
    excludedFiles: string[];
  };
  testGeneration: {
    framework: string;
    includeMocks: boolean;
    edgeCases: boolean;
  };
  llm: {
    model: string;
    temperature: number;
    summarizeOnly: boolean;
  };
}

export function loadConfig(): Config {
  const configPath = path.resolve(__dirname, '../rag-config.json');
  const raw = fs.readFileSync(configPath, 'utf-8');
  return JSON.parse(raw);
}