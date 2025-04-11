import json

def load_config(path="rag-config.json"):
    with open(path, "r") as file:
        return json.load(file)
