import * as fs from 'fs/promises';
import * as path from 'path';
import { 
  parseProjectConfig, 
  extractTestCaseMetadata, 
  saveMetadata, 
  ProjectConfig,
  DriverMetadata,
  TestCaseMetadata
} from './parser';

// Constants
const PROJECT_CONFIGS_DIR = path.join(__dirname, 'project_configs');
const OUTPUT_DIR = path.join(__dirname, 'processed');
const DRIVER_METADATA_DIR = path.join(OUTPUT_DIR, 'drivers');
const TEST_CASE_METADATA_DIR = path.join(OUTPUT_DIR, 'test_cases');

/**
 * Processes all project configuration files and generates metadata
 */
async function processAllConfigs(): Promise<void> {
  try {
    // Ensure output directories exist
    await fs.mkdir(DRIVER_METADATA_DIR, { recursive: true });
    await fs.mkdir(TEST_CASE_METADATA_DIR, { recursive: true });
    
    // Get all YAML files in the project configs directory
    const files = await fs.readdir(PROJECT_CONFIGS_DIR);
    const yamlFiles = files.filter(file => 
      file.endsWith('.yml') || file.endsWith('.yaml')
    );
    
    console.log(`Found ${yamlFiles.length} project configuration files`);
    
    // Process each configuration file
    for (const file of yamlFiles) {
      const driverName = path.basename(file, path.extname(file));
      console.log(`Processing ${driverName} configuration...`);
      
      const filePath = path.join(PROJECT_CONFIGS_DIR, file);
      const config = await parseProjectConfig(filePath);
      
      // Extract test case metadata
      const testCaseMetadata = extractTestCaseMetadata(config, driverName);
      
      // Create driver metadata
      const driverMetadata: DriverMetadata = {
        name: driverName,
        boardSupport: config.boards,
        osSupport: config.supportedOS,
        testCases: testCaseMetadata.map((tc, idx) => 
          `${driverName}_${tc.testType}_${idx}`
        ),
        sourceFiles: getAllSourceFiles(config),
      };
      
      // Save driver metadata
      await saveMetadata(
        driverMetadata, 
        path.join(DRIVER_METADATA_DIR, `${driverName}.json`)
      );
      
      // Save test case metadata
      for (let i = 0; i < testCaseMetadata.length; i++) {
        const tc = testCaseMetadata[i];
        const testCaseName = `${driverName}_${tc.testType}_${i}`;
        
        await saveMetadata(
          tc,
          path.join(TEST_CASE_METADATA_DIR, `${testCaseName}.json`)
        );
      }
      
      console.log(`✅ Processed ${driverName} configuration`);
    }
    
    console.log('All configurations processed successfully');
  } catch (error) {
    console.error('Error processing configurations:', error);
  }
}

/**
 * Gets all source files from a configuration
 * @param config Project configuration
 * @returns Array of all source files
 */
function getAllSourceFiles(config: ProjectConfig): string[] {
  const sourceFiles: string[] = [];
  const addedFiles = new Set<string>();
  
  for (const key in config.fileLists) {
    if (config.fileLists[key]) {
      // Check if the entry is an array
      if (Array.isArray(config.fileLists[key])) {
        for (const file of config.fileLists[key] as any[]) {
          if (!file.path.includes("[TEST]") && 
              /\.c$/i.test(file.path) && 
              !addedFiles.has(file.path)) {
            sourceFiles.push(file.path);
            addedFiles.add(file.path);
          }
        }
      } else if (typeof config.fileLists[key] === 'object') {
        // It's a nested section, we need to process its sub-sections recursively
        console.log(`Processing nested sections in ${key}`);
        const nestedSections = config.fileLists[key] as Record<string, any>;
        for (const subKey in nestedSections) {
          const subSection = nestedSections[subKey];
          if (Array.isArray(subSection)) {
            for (const file of subSection) {
              if (!file.path.includes("[TEST]") && 
                  /\.c$/i.test(file.path) && 
                  !addedFiles.has(file.path)) {
                sourceFiles.push(file.path);
                addedFiles.add(file.path);
              }
            }
          }
        }
      }
    }
  }
  
  return sourceFiles;
}

// Execute the script
processAllConfigs()
  .then(() => console.log('Metadata processing complete'))
  .catch((err) => console.error('Error:', err)); 