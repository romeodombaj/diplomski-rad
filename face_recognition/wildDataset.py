from sklearn.datasets import fetch_lfw_people
# This will download the dataset to ~/scikit_learn_data/
import os
path = os.path.join("data", "negative")

# download data
#lfw_people = fetch_lfw_people(data_home=path, min_faces_per_person=70, resize=0.4, download_if_missing=True)

# flatten from subfolders data/negative folder
for directory in os.listdir(os.path.join("lfw_home", "lfw_funneled")):
    for file in os.listdir(os.path.join("lfw_home", "lfw_funneled", directory)):
        CURRENT_PATH = os.path.join("lfw_home", "lfw_funneled", directory, file)
        NEW_PATH = os.path.join("data", "negative", file)
        os.replace(CURRENT_PATH, NEW_PATH)