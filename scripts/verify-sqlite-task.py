import sqlite3
import sys

db_path = sys.argv[1]
with sqlite3.connect(db_path) as connection:
    projects = connection.execute("SELECT COUNT(*) FROM projects").fetchone()[0]
    completed = connection.execute("SELECT COUNT(*) FROM tasks WHERE status = 'completed'").fetchone()[0]
print(f"{projects} {completed}")
