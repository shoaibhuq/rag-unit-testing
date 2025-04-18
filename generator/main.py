import os

from dotenv import load_dotenv
from langchain_openai import ChatOpenAI
from langchain.prompts import PromptTemplate
from langchain.schema import StrOutputParser
from langchain.output_parsers.json import SimpleJsonOutputParser
from langchain.schema.runnable import RunnablePassthrough
from langchain.globals import set_debug

set_debug(True)

CHAIN_DELIMITER = "<|PROMPT|>"

load_dotenv()
os.environ["OPENAI_API_KEY"] = os.getenv("OPENAI_API_KEY")

llm = ChatOpenAI(model="gpt-4.5-preview")

example_file_contents = open("NVS.c").read()


summaries_promopt = PromptTemplate.from_template(
    """
Based on the following file, list all methods in JSON format as the following:
{json_example}
The description should include information such as:
- Comments
- Related functions
- What the function returns (not just the return type, but a description of what the return value is)
- Extra context and assumptions

{file_contents}
""",
    partial_variables={
        "json_example": """
            export interface FunctionInfo {
              [name: string]: {
                description: string;
                returnType: string;
                parameters: Record<string, { description: string; type: string }>;
              };
            }
        """
    },
)

testable_functions_prompt = PromptTemplate.from_template(
    """Given the following function summaries, narrow down the list of functions you should test and return them as an array.
    Only output a raw, parsable JSON string, with no additional formatting, markdown, or code block syntax.
    Do not enclose the output in triple backticks or any other delimiters.

    Summaries: {summaries}"""
)

# Explore good/bad conditions for each testable function.
explore_conditions_prompt = PromptTemplate.from_template(
    """
  Given a list of testable functions and the source code for each, explore testable conditions (e.g. expected return valve, if statements, loops, etc.) for each function.
  Always consider these conditions: 
  - What if the function is partially successful (i.e. what if a read completes halfway?)
  - What if the function completely fails? 

  Go through all possible parameters, including edge cases. What happens if parameter A is null? What happens if parameter B is valid but does not exist in the database?
  For example:
  fn read_and_sum(file_A, file_B, offset_A, offset_B):
  - What if file_A/file_B is null?
  - What if offset_A/offset_B is a negative number?
  - What if everything is valid but A or B are greater than the file size?
  - What if a read is successful but the sum exceeds the max value of an int?
  - What if the read fails?
  - What if the read valud value is not an int?

  You MUST include ALL POSSIBLE CONDITIONS and ALL POSSIBLE PARAMETERS. DO NOT ASSUME that the a success or failure condition can cover other conditions.
  You should also include any other conditions that you think are important to test.

  Output the result in JSON format where the keys are the function names and the values the list of conditions as a paragraph description.
  The description should include information such as:
  - Whether the condition is a success or failure condition
  - What the condition is checking for
  - What the condition is doing
  - Any other relevant information

  Example output:
  {{
    "function_name": [
      "condition_1 is a success condition that checks for X and does Y. The return value should be Z",
      "condition_2 is a failure condition that checks for A and does B. The return value should be C",
      "condition_3 is a condition that checks for D if paremter E is F and does G. The return value should be H",
      "condition_4 is a condition that checks for I if parameter J is K and does L. The return value should be M",
    ]
  }}

  Only output a raw, parsable JSON string, with no additional formatting, markdown, or code block syntax.
  Do not enclose the output in triple backticks or any other delimiters.

  Testable functions: {function}
  Source code: {file_contents}
"""
)

test_generation_prompt = PromptTemplate.from_template(
    """
Given the following instructions on generating tests, the conditions your test should explore, and the source code generate a test for {function_name}.

For each condition, create a initialize -> call -> validate pattern within the test function. Always comment beforehand to clarify your intent.
The test should be in the style of Unity tests, which are used for testing embedded systems. The tests should be written in C and follow the Unity test framework conventions.
Test functions should be named test_<module_name>_<function_name>.
DO NOT CREATE MOCKS, tests are run on real hardware.

Only output a raw C code, with no additional formatting, markdown, or code block syntax. Do not enclose the output in triple backticks or any other delimiters.

Conditions: {conditions}
Source code: {file_contents}
"""
)

llm = ChatOpenAI()

summaries_chain = summaries_promopt | llm | StrOutputParser()
testable_functions_chain = testable_functions_prompt | llm | SimpleJsonOutputParser()
explore_conditions_chain = explore_conditions_prompt | llm | SimpleJsonOutputParser()
test_generation_chain = test_generation_prompt | llm | StrOutputParser()
chain = {
    "summaries": summaries_chain,
    "file_contents": RunnablePassthrough(),
} | RunnablePassthrough.assign(testable_functions=testable_functions_chain)
testable_functions = chain.invoke({"file_contents": example_file_contents})[
    "testable_functions"
]

conditions = {}
for function in testable_functions:
    result = explore_conditions_chain.invoke(
        {"function": function, "file_contents": example_file_contents}
    )
    conditions[function] = result[function]


results = []
for function in testable_functions:
    condition = conditions[function]
    result = test_generation_chain.invoke(
        {
            "function_name": function,
            "conditions": condition,
            "file_contents": example_file_contents,
        }
    )
    results.append(result)

print(results)
