def generate_tests(functions, test_config):
    for fn in functions:
        print(f"Generating tests for {fn['function']} using {test_config['framework']}")
