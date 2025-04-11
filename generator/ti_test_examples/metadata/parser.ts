import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'js-yaml';

// Define interfaces for project configuration
export interface ProjectConfig {
  tools: string[];
  supportedOS: string[];
  boards: string[];
  configurations: Array<{
    name: string;
    boards?: string[];
  }>;
  fileLists: {
    [key: string]: Array<{
      path: string;
      targetDirectory?: string;
    }>;
  };
}

// Define interfaces for test case metadata
export interface TestCaseMetadata {
  driver: string;
  testType: 'general' | 'board_specific';
  boardSupport: string[];
  osSupport: string[];
  toolchain: string[];
  dependencies: string[];
  testFiles: {
    c: string[];
    h?: string[];
    py?: string[];
    syscfg?: string[];
  };
  sourceFiles: string[];
  description?: string;
  created: string;
  updated: string;
}

// Define interfaces for driver metadata
export interface DriverMetadata {
  name: string;
  description?: string;
  boardSupport: string[];
  osSupport: string[];
  testCases: string[]; // References to test case IDs
  sourceFiles: string[];
}

/**
 * Parses a YAML project configuration file
 * @param filePath Path to the YAML project file
 * @returns ProjectConfig object
 */
export async function parseProjectConfig(filePath: string): Promise<ProjectConfig> {
  try {
    const fileContent = await fs.readFile(filePath, 'utf8');
    const config = yaml.load(fileContent) as ProjectConfig;
    return config;
  } catch (error) {
    console.error(`Error parsing project config ${filePath}:`, error);
    throw error;
  }
}

/**
 * Extracts test case metadata from a project configuration
 * @param config Project configuration object
 * @param driverName Name of the driver
 * @returns TestCaseMetadata object
 */
export function extractTestCaseMetadata(
  config: ProjectConfig,
  driverName: string
): TestCaseMetadata[] {
  const metadata: TestCaseMetadata[] = [];
  
  // Parse general test files
  const generalTestFiles = extractTestFilesByType(config, 'all', /test.*\.c$/i);
  
  if (generalTestFiles.length > 0) {
    const generalTestCase: TestCaseMetadata = {
      driver: driverName,
      testType: 'general',
      boardSupport: config.boards,
      osSupport: config.supportedOS,
      toolchain: config.tools,
      dependencies: extractSourceFiles(config, 'all'),
      testFiles: {
        c: generalTestFiles,
        h: extractTestFilesByType(config, 'all', /test.*\.h$/i),
        py: extractTestFilesByType(config, 'all', /test.*\.py$/i),
        syscfg: extractTestFilesByType(config, 'all', /.*\.syscfg$/i),
      },
      sourceFiles: extractSourceFiles(config, 'all'),
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
    };
    
    metadata.push(generalTestCase);
  }
  
  // Parse board-specific test files
  for (const key in config.fileLists) {
    // Only process board-specific sections (starting with 'all_')
    if (key.startsWith('all_') && key !== 'all') {
      let boardSpecificFiles: string[] = [];
      
      // Direct files in this section
      if (Array.isArray(config.fileLists[key])) {
        boardSpecificFiles = extractTestFilesByType(config, key, /test.*\.c$/i);
      } 
      // Nested sections
      else if (typeof config.fileLists[key] === 'object') {
        // First check if there's an 'all' subsection in the nested object
        const nestedSections = config.fileLists[key] as Record<string, any>;
        if (nestedSections['all'] && Array.isArray(nestedSections['all'])) {
          // Extract test files from the 'all' subsection
          for (const file of nestedSections['all']) {
            if (file.path && /test.*\.c$/i.test(file.path)) {
              boardSpecificFiles.push(file.path);
            }
          }
        }
      }
      
      if (boardSpecificFiles.length > 0) {
        const boardTestCase: TestCaseMetadata = {
          driver: driverName,
          testType: 'board_specific',
          boardSupport: [key.replace('all_', '')],
          osSupport: config.supportedOS,
          toolchain: config.tools,
          dependencies: extractSourceFiles(config, key),
          testFiles: {
            c: boardSpecificFiles,
            h: [],  // We'll handle these manually for nested sections
            py: [],  // We'll handle these manually for nested sections
            syscfg: [], // We'll handle these manually for nested sections
          },
          sourceFiles: extractSourceFiles(config, key),
          created: new Date().toISOString(),
          updated: new Date().toISOString(),
        };
        
        // Manually handle other file types for nested sections
        if (typeof config.fileLists[key] === 'object') {
          const nestedSections = config.fileLists[key] as Record<string, any>;
          if (nestedSections['all'] && Array.isArray(nestedSections['all'])) {
            for (const file of nestedSections['all']) {
              if (file.path) {
                if (/test.*\.h$/i.test(file.path)) {
                  boardTestCase.testFiles.h!.push(file.path);
                } else if (/test.*\.py$/i.test(file.path)) {
                  boardTestCase.testFiles.py!.push(file.path);
                } else if (/.*\.syscfg$/i.test(file.path)) {
                  boardTestCase.testFiles.syscfg!.push(file.path);
                }
              }
            }
          }
        } else {
          // Standard array sections
          boardTestCase.testFiles.h = extractTestFilesByType(config, key, /test.*\.h$/i);
          boardTestCase.testFiles.py = extractTestFilesByType(config, key, /test.*\.py$/i);
          boardTestCase.testFiles.syscfg = extractTestFilesByType(config, key, /.*\.syscfg$/i);
        }
        
        metadata.push(boardTestCase);
      }
    }
  }
  
  return metadata;
}

/**
 * Extracts test files matching a specific pattern from a configuration section
 * @param config Project configuration
 * @param section Section name in fileLists
 * @param pattern Regular expression to match file paths
 * @returns Array of matching file paths
 */
function extractTestFilesByType(
  config: ProjectConfig,
  section: string,
  pattern: RegExp
): string[] {
  const files: string[] = [];
  
  if (config.fileLists[section]) {
    // Check if the section is an array
    if (Array.isArray(config.fileLists[section])) {
      // Handle array structure
      for (const file of config.fileLists[section] as any[]) {
        if (pattern.test(file.path)) {
          files.push(file.path);
        }
      }
    } else if (typeof config.fileLists[section] === 'object') {
      // Handle object structure (e.g., nested sections)
      // Just skip it for now as it contains nested sections instead of files
      console.log(`Skipping object structure in section ${section} - contains nested sections`);
    }
  }
  
  return files;
}

/**
 * Extracts source files from a configuration section
 * @param config Project configuration
 * @param section Section name in fileLists
 * @returns Array of source file paths
 */
function extractSourceFiles(config: ProjectConfig, section: string): string[] {
  const files: string[] = [];
  
  if (config.fileLists[section]) {
    // Check if the section is an array
    if (Array.isArray(config.fileLists[section])) {
      // Handle array structure
      for (const file of config.fileLists[section] as any[]) {
        if (!file.path.includes("[TEST]") && /\.c$/i.test(file.path)) {
          files.push(file.path);
        }
      }
    } else if (typeof config.fileLists[section] === 'object') {
      // Handle object structure (e.g., nested sections)
      // Just skip it for now as it contains nested sections instead of files
      console.log(`Skipping object structure in section ${section} - contains nested sections`);
    }
  }
  
  return files;
}

/**
 * Saves metadata to a JSON file
 * @param metadata Metadata object to save
 * @param outputPath Path to save the metadata file
 */
export async function saveMetadata<T>(metadata: T, outputPath: string): Promise<void> {
  try {
    const dirPath = path.dirname(outputPath);
    await fs.mkdir(dirPath, { recursive: true });
    await fs.writeFile(outputPath, JSON.stringify(metadata, null, 2), 'utf8');
    console.log(`Metadata saved to ${outputPath}`);
  } catch (error) {
    console.error(`Error saving metadata to ${outputPath}:`, error);
    throw error;
  }
} 