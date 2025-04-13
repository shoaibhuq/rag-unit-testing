import * as vscode from "vscode";

interface ValidationResult {
  valid: boolean;
  score: number;
  feedback: string[];
  improvementSuggestions: string[];
  isBoardSpecific?: boolean;
}

interface ValidationCriteria {
  hasSetup: boolean;
  hasAssertions: boolean;
  hasCleanup: boolean;
  hasDocumentation: boolean;
  hasErrorHandling: boolean;
  followsNamingConventions: boolean;
  hasBoardChecks?: boolean;
  hasHardwareConfig?: boolean;
}

/**
 * Validates test cases against TI best practices
 */
export class TestCaseValidator {
  // Initialization patterns
  private setupPatterns = [
    /commonTestOpen/i,
    /setUp/i,
    /initialize/i,
    /init.*Test/i
  ];

  // Assertion patterns
  private assertionPatterns = [
    /assert/i,
    /TEST_ASSERT/i,
    /EXPECT_/i,
    /verify/i,
    /check/i
  ];

  // Cleanup patterns
  private cleanupPatterns = [
    /commonTestClose/i,
    /tearDown/i,
    /cleanup/i,
    /finalize/i,
    /free/i
  ];

  // Error handling patterns
  private errorHandlingPatterns = [
    /if\s*\(.*error/i,
    /try\s*{/i,
    /catch\s*\(/i,
    /return.*error/i
  ];

  // Documentation patterns
  private documentationPatterns = [
    /\/\*\*/i,
    /\/\*\s*Test/i,
    /\/\/\s*Test/i,
    /\*\s*@brief/i
  ];

  // Function naming patterns
  private namingPatterns = [
    /test_[a-zA-Z][a-zA-Z0-9_]*/i,
    /[a-zA-Z][a-zA-Z0-9_]*_test/i
  ];
  
  // Board check patterns
  private boardCheckPatterns = [
    /board\s*\.\s*match/i,
    /#if defined\(CC13/i,
    /#if defined\(CC26/i,
    /#if defined\(CC23/i,
    /#if defined\(__CC/i,
    /if\s*\(\s*board\s*==\s*[\"\']CC/i,
    /DEVICE_FAMILY_(CC13|CC26|CC23)/i
  ];
  
  // Hardware configuration patterns
  private hardwareConfigPatterns = [
    /SPI\.\$hardware\s*=/i,
    /SPI[0-9]?\.\$assign\s*=/i,
    /GPIO\.\$hardware\s*=/i,
    /UART\.\$hardware\s*=/i,
    /PWM\.\$hardware\s*=/i,
    /\.pin\.\$assign\s*=/i,
    /\.spi\.\$assign\s*=/i,
    /\.GPIO\.\$assign\s*=/i,
    /pinConfigurations/i,
    /SysConfig/i
  ];

  /**
   * Validates a generated test case
   * @param testCode The test case code to validate
   * @returns ValidationResult with score and feedback
   */
  validate(testCode: string): ValidationResult {
    // Track validation criteria
    const criteria: ValidationCriteria = {
      hasSetup: false,
      hasAssertions: false,
      hasCleanup: false,
      hasDocumentation: false,
      hasErrorHandling: false,
      followsNamingConventions: false
    };
    
    // Detect if this is a board-specific test
    const isBoardSpecific = this.detectBoardSpecificTest(testCode);
    
    // If board-specific, add additional criteria
    if (isBoardSpecific) {
      criteria.hasBoardChecks = false;
      criteria.hasHardwareConfig = false;
    }

    // Check for initialization/setup
    criteria.hasSetup = this.setupPatterns.some(pattern => 
      pattern.test(testCode)
    );

    // Check for assertions
    criteria.hasAssertions = this.assertionPatterns.some(pattern => 
      pattern.test(testCode)
    );

    // Check for cleanup
    criteria.hasCleanup = this.cleanupPatterns.some(pattern => 
      pattern.test(testCode)
    );

    // Check for error handling
    criteria.hasErrorHandling = this.errorHandlingPatterns.some(pattern => 
      pattern.test(testCode)
    );

    // Check for documentation
    criteria.hasDocumentation = this.documentationPatterns.some(pattern => 
      pattern.test(testCode)
    );

    // Check for naming conventions
    criteria.followsNamingConventions = this.namingPatterns.some(pattern => {
      // Extract function names from the code
      const functionMatches = testCode.match(/\w+\s+(\w+)\s*\(/g);
      if (!functionMatches) return false;
      
      // Check each function name against the pattern
      return functionMatches.some(func => {
        const match = func.match(/\s+(\w+)\s*\(/);
        if (!match) return false;
        return pattern.test(match[1]);
      });
    });
    
    // For board-specific tests, add additional checks
    if (isBoardSpecific) {
      // Check for board detection logic
      criteria.hasBoardChecks = this.boardCheckPatterns.some(pattern => 
        pattern.test(testCode)
      );
      
      // Check for hardware configuration
      criteria.hasHardwareConfig = this.hardwareConfigPatterns.some(pattern => 
        pattern.test(testCode)
      );
    }

    // Calculate score (each criterion is worth the same)
    const criteriaCount = Object.keys(criteria).length;
    const passedCriteria = Object.values(criteria).filter(Boolean).length;
    const score = Math.round((passedCriteria / criteriaCount) * 100);

    // Generate feedback and improvement suggestions
    const feedback: string[] = [];
    const improvementSuggestions: string[] = [];

    // Add feedback for each criterion
    if (criteria.hasSetup) {
      feedback.push("✅ The test includes proper setup/initialization");
    } else {
      feedback.push("❌ The test is missing proper setup/initialization");
      improvementSuggestions.push(
        "Add initialization code using commonTestOpen() or a similar function"
      );
    }

    if (criteria.hasAssertions) {
      feedback.push("✅ The test includes assertions");
    } else {
      feedback.push("❌ The test is missing assertions");
      improvementSuggestions.push(
        "Add appropriate assertions to verify expected outcomes"
      );
    }

    if (criteria.hasCleanup) {
      feedback.push("✅ The test includes proper cleanup");
    } else {
      feedback.push("❌ The test is missing cleanup code");
      improvementSuggestions.push(
        "Add cleanup code using commonTestClose() or similar to release resources"
      );
    }

    if (criteria.hasErrorHandling) {
      feedback.push("✅ The test includes error handling");
    } else {
      feedback.push("❌ The test is missing error handling");
      improvementSuggestions.push(
        "Add error handling to gracefully handle failures"
      );
    }

    if (criteria.hasDocumentation) {
      feedback.push("✅ The test is properly documented");
    } else {
      feedback.push("❌ The test is missing documentation");
      improvementSuggestions.push(
        "Add documentation comments describing the test purpose and behavior"
      );
    }

    if (criteria.followsNamingConventions) {
      feedback.push("✅ The test follows TI naming conventions");
    } else {
      feedback.push("❌ The test doesn't follow naming conventions");
      improvementSuggestions.push(
        "Rename test functions to follow TI convention: test_functionName()"
      );
    }
    
    // Add feedback for board-specific criteria if applicable
    if (isBoardSpecific) {
      if (criteria.hasBoardChecks) {
        feedback.push("✅ The test includes board detection logic");
      } else {
        feedback.push("❌ The test is missing board detection logic");
        improvementSuggestions.push(
          "Add board detection using #if defined() or board.match() logic"
        );
      }
      
      if (criteria.hasHardwareConfig) {
        feedback.push("✅ The test includes hardware configuration");
      } else {
        feedback.push("❌ The test is missing hardware configuration");
        improvementSuggestions.push(
          "Add hardware configuration code for the specific board being tested"
        );
      }
    }

    return {
      valid: score >= 70, // Consider valid if score is at least 70%
      score,
      feedback,
      improvementSuggestions,
      isBoardSpecific
    };
  }
  
  /**
   * Detects if a test is board-specific
   * @param testCode The test code to check
   * @returns True if the test appears to be board-specific
   */
  private detectBoardSpecificTest(testCode: string): boolean {
    // Check for board-specific indicators in the code
    const boardIndicators = [
      /CC13/i,
      /CC26/i,
      /CC23/i,
      /CC35/i,
      /board\.match/i,
      /LAUNCHXL/i,
      /DEVICE_FAMILY/i,
      /hardware configuration/i,
      /board-specific/i,
      /pinConfig/i,
      /\.pin\.\$assign/i
    ];
    
    return boardIndicators.some(pattern => pattern.test(testCode));
  }

  /**
   * Shows validation results in a webview panel
   * @param result Validation result to display
   * @param testCode Original test code
   */
  showValidationResults(result: ValidationResult, testCode: string): void {
    // Create webview panel
    const panel = vscode.window.createWebviewPanel(
      'testValidation',
      'Test Validation Results',
      vscode.ViewColumn.Beside,
      { enableScripts: true }
    );

    // Create HTML content
    const content = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Test Validation Results</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 20px; }
          .score { font-size: 24px; font-weight: bold; margin-bottom: 20px; }
          .score-high { color: #4CAF50; }
          .score-medium { color: #FF9800; }
          .score-low { color: #F44336; }
          .feedback-item { margin-bottom: 8px; }
          .suggestions { margin-top: 20px; }
          .suggestion-item { margin-bottom: 8px; color: #0277BD; }
          .code-container { 
            background-color: #f5f5f5; 
            padding: 15px; 
            margin-top: 20px;
            border-radius: 4px;
            overflow: auto;
            max-height: 300px;
          }
          pre { margin: 0; white-space: pre-wrap; }
          .test-type {
            background-color: #E0E0E0;
            padding: 8px;
            border-radius: 4px;
            display: inline-block;
            margin-bottom: 15px;
          }
          .board-specific {
            background-color: #BBDEFB;
            color: #0D47A1;
          }
        </style>
      </head>
      <body>
        <h1>Test Validation Results</h1>
        
        ${result.isBoardSpecific ? 
          `<div class="test-type board-specific">Board-Specific Test</div>` : 
          `<div class="test-type">General Test</div>`}
        
        <div class="score ${
          result.score >= 80 ? 'score-high' : 
          result.score >= 60 ? 'score-medium' : 'score-low'
        }">
          Score: ${result.score}%
        </div>
        
        <h2>Feedback</h2>
        <div class="feedback">
          ${result.feedback.map(item => 
            `<div class="feedback-item">${item}</div>`
          ).join('')}
        </div>
        
        ${result.improvementSuggestions.length > 0 ? `
          <h2>Improvement Suggestions</h2>
          <div class="suggestions">
            ${result.improvementSuggestions.map(item => 
              `<div class="suggestion-item">• ${item}</div>`
            ).join('')}
          </div>
        ` : ''}
        
        <h2>Test Code</h2>
        <div class="code-container">
          <pre><code>${this.escapeHtml(testCode)}</code></pre>
        </div>
      </body>
      </html>
    `;

    // Set HTML content
    panel.webview.html = content;
  }

  /**
   * Escape HTML to prevent XSS in webview
   */
  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
} 