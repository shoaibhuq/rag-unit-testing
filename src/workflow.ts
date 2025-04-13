// Import required classes from LangChain
import { ChatOpenAI } from "@langchain/openai";
import { SystemMessage, HumanMessage, AIMessage } from "@langchain/core/messages";
import { SimpleVectorManager } from "./simple-vector";
import { TITestIntegrator } from "./ti-test-integrator";
import path from 'path';

// Define interface for graph state
interface GraphState {
  functionName: string;
  functionCode: string;
  filePath: string;
  similarFunctionsCode?: string;
  generatedTestCode?: string;
  errorMessage?: string;
}

/**
 * Retrieves relevant context for a function from vector store and TI examples
 */
async function retrieveContext(
  state: GraphState,
  vectorManager: SimpleVectorManager,
  tiTestIntegrator: TITestIntegrator
): Promise<Partial<GraphState>> {
  try {
    const { functionCode, functionName, filePath } = state;

    if (!functionCode) {
      return {
        errorMessage: "No function code provided for context retrieval",
      };
    }

    console.log(`Retrieving context for function: ${functionName || "(unnamed)"}`);

    // Try to detect board type from function code or filename
    let boardType: string | undefined;
    if (filePath) {
      // Check filename for board indicators
      const fileName = path.basename(filePath).toLowerCase();
      if (fileName.includes('cc13') || fileName.includes('cc26')) {
        boardType = fileName.includes('cc13') ? 'CC13' : 'CC26';
        if (fileName.includes('r7')) boardType += 'R7';
        else if (fileName.includes('r2')) boardType += 'R2';
      } else if (fileName.includes('cc23')) {
        boardType = 'CC23';
      } else if (fileName.includes('cc35')) {
        boardType = 'CC35';
      }
    }
    
    // If not found in filename, try to detect from code
    if (!boardType && functionCode) {
      if (functionCode.includes('CC13') || functionCode.includes('cc13')) {
        boardType = 'CC13';
      } else if (functionCode.includes('CC26') || functionCode.includes('cc26')) {
        boardType = 'CC26';
      } else if (functionCode.includes('CC23') || functionCode.includes('cc23')) {
        boardType = 'CC23';
      } else if (functionCode.includes('CC35') || functionCode.includes('cc35')) {
        boardType = 'CC35';
      }
    }

    if (boardType) {
      console.log(`Detected board type: ${boardType} - including hardware configs`);
    }

    // Find similar functions in the vector store
    const similarFunctions = await vectorManager.findSimilarWithFilters(
      functionCode,
      undefined, // No specific metadata filters yet
      5 // Retrieve top 5 matches
    );

    // Get TI-specific test patterns for different test sections, including hardware config if board type detected
    const tiPatterns = await tiTestIntegrator.getRelevantPatterns(functionCode, boardType);
    
    // Build enhanced context
    let context = `I need to create a unit test for the following function:\n\n${functionCode}\n\n`;
    
    // Add board type information if detected
    if (boardType) {
      context += `This code appears to be for ${boardType} series devices.\n\n`;
    }
    
    // Add similar functions context
    if (similarFunctions.length > 0) {
      context += "Here are some similar functions with existing test cases:\n\n";
      similarFunctions.forEach((func: any, i: number) => {
        context += `Similar Function ${i + 1}: ${func.functionName}\n\`\`\`c\n${func.content}\n\`\`\`\n\n`;
      });
    } else {
      context += "No directly similar functions found. Using general test patterns.\n\n";
    }
    
    // Add TI test pattern examples by section
    context += "Here are relevant test patterns to follow:\n\n";
    
    // Setup patterns
    if (tiPatterns.setup && tiPatterns.setup.length > 0) {
      context += "SETUP PATTERNS:\n";
      tiPatterns.setup.forEach((pattern: any, i: number) => {
        context += `Pattern ${i + 1}:\n\`\`\`c\n${pattern.code}\n\`\`\`\n\n`;
      });
    }
    
    // Test execution patterns
    if (tiPatterns.execution && tiPatterns.execution.length > 0) {
      context += "TEST EXECUTION PATTERNS:\n";
      tiPatterns.execution.forEach((pattern: any, i: number) => {
        context += `Pattern ${i + 1}:\n\`\`\`c\n${pattern.code}\n\`\`\`\n\n`;
      });
    }
    
    // Assertion patterns
    if (tiPatterns.assertion && tiPatterns.assertion.length > 0) {
      context += "ASSERTION PATTERNS:\n";
      tiPatterns.assertion.forEach((pattern: any, i: number) => {
        context += `Pattern ${i + 1}:\n\`\`\`c\n${pattern.code}\n\`\`\`\n\n`;
      });
    }
    
    // Cleanup patterns
    if (tiPatterns.cleanup && tiPatterns.cleanup.length > 0) {
      context += "CLEANUP PATTERNS:\n";
      tiPatterns.cleanup.forEach((pattern: any, i: number) => {
        context += `Pattern ${i + 1}:\n\`\`\`c\n${pattern.code}\n\`\`\`\n\n`;
      });
    }
    
    // Error handling patterns
    if (tiPatterns.errorHandling && tiPatterns.errorHandling.length > 0) {
      context += "ERROR HANDLING PATTERNS:\n";
      tiPatterns.errorHandling.forEach((pattern: any, i: number) => {
        context += `Pattern ${i + 1}:\n\`\`\`c\n${pattern.code}\n\`\`\`\n\n`;
      });
    }
    
    // Hardware configuration patterns if a board type was detected
    if (boardType && tiPatterns['hardware-config'] && tiPatterns['hardware-config'].length > 0) {
      context += "HARDWARE CONFIGURATION PATTERNS:\n";
      context += "These configurations are necessary for initializing hardware on specific boards.\n";
      tiPatterns['hardware-config'].forEach((pattern: any, i: number) => {
        context += `${boardType} Configuration ${i + 1}:\n\`\`\`javascript\n${pattern.code}\n\`\`\`\n\n`;
      });
      
      context += "When testing hardware functionality, ensure you:\n";
      context += "1. Check for the specific board type using conditional statements\n";
      context += "2. Apply the appropriate SysConfig settings for the detected board\n";
      context += "3. Initialize hardware components according to board-specific requirements\n\n";
    }
    
    // Add TI test structure guidelines
    context += `
TI TEST STRUCTURE GUIDELINES:
1. Always include proper setup and initialization
2. Test the main functionality with appropriate input parameters
3. Check for edge cases and error conditions
4. Include proper resource cleanup
5. Follow TI naming conventions for test functions: test_<functionality>
6. Use appropriate assertion macros from TI's testing framework
7. Document the test purpose and behavior
`;

    // Add board-specific guidelines if board type was detected
    if (boardType) {
      context += `
BOARD-SPECIFIC TESTING GUIDELINES:
1. Always check for board type using preprocessor conditionals or runtime checks
2. For ${boardType} series, use the appropriate pin configurations from SysConfig
3. Include fallback behavior for unsupported boards
4. Test board-specific features only when the appropriate board is detected
`;
    }

    console.log("Enhanced context retrieved successfully");
    return {
      similarFunctionsCode: context,
    };
  } catch (error: any) {
    console.error("Error retrieving context:", error);
    return {
      errorMessage: `Error retrieving context: ${error.message}`,
    };
  }
}

import { TestCaseValidator } from "./test-validator";

/**
 * Generates test cases based on provided context and function information
 */
async function generateTests(state: GraphState): Promise<Partial<GraphState>> {
  try {
    const { functionCode, functionName, filePath, similarFunctionsCode } = state;

    if (!functionCode) {
      return {
        errorMessage: "No function code provided for test generation",
      };
    }

    if (!similarFunctionsCode) {
      return {
        errorMessage: "No context retrieved for test generation",
      };
    }

    console.log(`Generating tests for function: ${functionName || "(unnamed)"}`);

    const model = new ChatOpenAI({
      modelName: "gpt-4o",
      temperature: 0.2,
      maxTokens: 4096,
    });

    // Define the system prompt
    const systemPrompt = `You are an expert C programmer specializing in creating unit tests for embedded systems, particularly for Texas Instruments (TI) hardware. 
Create comprehensive and correctly structured unit tests following TI's standard patterns. 
Your tests should include proper setup, assertions, error handling, and cleanup.

Follow these guidelines:
1. Create a complete test file, including all necessary includes and declarations
2. Implement proper setup/initialization using functions like commonTestOpen()
3. Test the main functionality with appropriate test data
4. Include error handling and edge cases
5. Perform proper cleanup/teardown using functions like commonTestClose()
6. Follow TI's naming conventions: test_functionName()
7. Add proper documentation comments explaining the purpose of each test
8. Use TI's assertion macros and testing patterns from the examples provided

Generate a single, complete, and well-structured test file.`;

    // Define the human message
    const humanMessage = `I need to create a unit test for the following function.
Use the similar functions and TI pattern examples as a guide.

${similarFunctionsCode}

Generate a complete test file in C, including all necessary headers, setup, test implementation, and cleanup. 
Follow TI's test pattern conventions exactly. Make the test thorough and comprehensive.`;

    // Generate test code
    const response = await model.invoke([
      new SystemMessage(systemPrompt),
      new HumanMessage(humanMessage),
    ]);

    // Extract test code from the response
    const testCode = response.content.toString();

    // Validate the generated test code
    const validator = new TestCaseValidator();
    const validationResult = validator.validate(testCode);

    console.log(`Test validation score: ${validationResult.score}%`);
    
    // Log validation results
    console.log("Validation feedback:");
    validationResult.feedback.forEach(feedback => console.log(` - ${feedback}`));
    
    if (validationResult.improvementSuggestions.length > 0) {
      console.log("Improvement suggestions:");
      validationResult.improvementSuggestions.forEach(suggestion => 
        console.log(` - ${suggestion}`)
      );
    }

    // If the test is valid, return it
    if (validationResult.valid) {
      return {
        generatedTestCode: testCode,
      };
    } 
    // If the test doesn't meet standards, try to improve it
    else {
      console.log("Generated test doesn't meet quality standards. Attempting to improve...");
      
      // Create an improved prompt based on validation feedback
      const improvementPrompt = `The unit test you generated needs improvement in the following areas:
${validationResult.improvementSuggestions.map(s => `- ${s}`).join('\n')}

Please revise the test code to address these issues while maintaining all the correct functionality.

Here's the current test code:
\`\`\`c
${testCode}
\`\`\`

Generate an improved version that follows TI's test conventions and addresses all the issues identified.`;

      // Generate improved test code
      const improvedResponse = await model.invoke([
        new SystemMessage(systemPrompt),
        new HumanMessage(humanMessage),
        new AIMessage(testCode),
        new HumanMessage(improvementPrompt),
      ]);

      // Extract improved test code
      const improvedTestCode = improvedResponse.content.toString();
      
      // Validate the improved code
      const improvedValidation = validator.validate(improvedTestCode);
      console.log(`Improved test validation score: ${improvedValidation.score}%`);
      
      return {
        generatedTestCode: improvedTestCode,
      };
    }
  } catch (error: any) {
    console.error("Error generating tests:", error);
    return {
      errorMessage: `Error generating tests: ${error.message}`,
    };
  }
} 