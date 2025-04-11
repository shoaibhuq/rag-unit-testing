import glob
import os

def scan_files(config):
    include = config["analyze"]["includedFiles"]
    exclude = config["analyze"]["excludedFiles"]
    
    included_files = []
    for pattern in include:
        included_files.extend(glob.glob(pattern, recursive=True))
    
    for pattern in exclude:
        excluded = set(glob.glob(pattern, recursive=True))
        included_files = [f for f in included_files if f not in excluded]

    return included_files
