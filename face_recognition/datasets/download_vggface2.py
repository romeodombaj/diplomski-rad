#!/usr/bin/env python3
"""Download VGGFace2 via BitTorrent (Academic Torrents) using libtorrent.

Source: https://academictorrents.com/details/535113b8395832f09121bc53ac85d7bc8ef6fa5b
Only the training archive is selected (skips the ~2GB test set) to save
disk space. Run in the background; safe to Ctrl-C and rerun (resumes via
the .fastresume-style state libtorrent keeps in SAVE_DIR).
"""
import time
import libtorrent as lt

MAGNET = (
    "magnet:?xt=urn:btih:535113b8395832f09121bc53ac85d7bc8ef6fa5b"
    "&tr=https%3A%2F%2Facademictorrents.com%2Fannounce.php"
    "&tr=udp%3A%2F%2Ftracker.coppersurfer.tk%3A6969"
    "&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337%2Fannounce"
)
SAVE_DIR = "/home/b2/projects/zavrsni/face_recognition/datasets/vggface2"

ses = lt.session({"listen_interfaces": "0.0.0.0:6881"})
params = lt.parse_magnet_uri(MAGNET)
params.save_path = SAVE_DIR
params.storage_mode = lt.storage_mode_t.storage_mode_sparse
handle = ses.add_torrent(params)

print("Fetching metadata from peers/trackers...", flush=True)
while not handle.status().has_metadata:
    time.sleep(1)

info = handle.torrent_file()
print(f"Metadata OK: {info.name()}, {info.total_size() / 1e9:.2f} GB, "
      f"{info.num_files()} files", flush=True)

priorities = [0] * info.num_files()
selected = []
for i in range(info.num_files()):
    fp = info.files().file_path(i)
    if "test" not in fp.lower():
        priorities[i] = 4
        selected.append(fp)
handle.prioritize_files(priorities)
print("Selected files:", selected, flush=True)

start = time.time()
last_pct = -1
while True:
    s = handle.status()
    pct = int(s.progress * 100)
    if pct != last_pct or int(time.time() - start) % 60 == 0:
        print(
            f"{pct}% | {s.total_wanted_done / 1e9:.2f}/{s.total_wanted / 1e9:.2f} GB "
            f"| DL {s.download_rate / 1e6:.2f} MB/s | peers {s.num_peers} "
            f"| state {s.state}",
            flush=True,
        )
        last_pct = pct
    if s.is_seeding or (s.total_wanted > 0 and s.total_wanted_done >= s.total_wanted):
        print("DOWNLOAD COMPLETE", flush=True)
        break
    time.sleep(5)
