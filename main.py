from pipeline.config_loader import load_config
from pipeline.file_scanner import scan_files
from pipeline.llm_prompter import summarize_functions
from pipeline.test_generator import generate_tests

def main():
    config = load_config()
    files = scan_files(config)

    for file_path in files:
        functions = summarize_functions(file_path, config["llm"])
        if not config["llm"]["summarizeOnly"]:
            generate_tests(functions, config["testGeneration"])

if __name__ == "__main__":
    main()
