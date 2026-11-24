# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
from genlayer import *
import json

SOURCE = "https://api.github.com/repos/"


def slug(value: str, punctuation: str, limit: int) -> bool:
    return 0 < len(value) <= limit and value not in (".", "..") and all(
        "a" <= c <= "z" or "0" <= c <= "9" or c in punctuation for c in value
    )


def inspect(owner: str, repo: str, number: int) -> str:
    response = gl.nondet.web.get(SOURCE + owner + "/" + repo + "/pulls/" + str(number))
    if response.status != 200:
        raise gl.UserError("GitHub source unavailable or private. Check the link or retry later.")
    data = json.loads(response.body)
    repository = data["base"]["repo"]
    author = data["user"]
    ids = [data["id"], repository["id"], repository["owner"]["id"], author["id"]]
    if any(type(value) is not int or value < 1 for value in ids) or data["number"] != number:
        raise gl.UserError("GitHub returned invalid attribution data.")
    merged = data["merged"]
    if type(merged) is not bool or data["state"] not in ("open", "closed"):
        raise gl.UserError("GitHub returned an invalid merge status.")
    merger_id = 0
    merged_at = ""
    result = "OPEN" if data["state"] == "open" else "CLOSED_UNMERGED"
    if merged:
        merger_id = data["merged_by"]["id"]
        merged_at = data["merged_at"]
        if type(merger_id) is not int or merger_id < 1 or not isinstance(merged_at, str) or not merged_at or data["state"] != "closed":
            raise gl.UserError("GitHub returned incomplete merge evidence.")
        result = "SELF_MERGE" if merger_id == author["id"] else "ISSUED"
    return json.dumps({
        "pull_id": data["id"], "number": number, "repository": repository["full_name"].lower(),
        "repository_id": repository["id"], "owner_id": repository["owner"]["id"],
        "author": author["login"].lower(), "author_id": author["id"],
        "merger_id": merger_id, "merged_at": merged_at, "result": result,
    }, sort_keys=True)


class Mergefolio(gl.Contract):
    count: u256
    records: TreeMap[u256, str]
    latest: TreeMap[str, str]
    profiles: TreeMap[str, str]
    credited_owners: TreeMap[str, bool]
    profile_records: TreeMap[str, u256]

    def __init__(self):
        self.count = u256(0)

    @gl.public.view
    def record_count(self) -> u256:
        return self.count

    @gl.public.view
    def get_record(self, record_id: u256) -> str:
        return self.records.get(record_id, "")

    @gl.public.view
    def get_profile(self, author_id: u256) -> str:
        return self.profiles.get(str(author_id), "")

    @gl.public.view
    def get_profile_record(self, author_id: u256, index: u256) -> u256:
        return self.profile_records.get(str(author_id) + ":" + str(index), u256(0))

    @gl.public.write
    def nominate(self, owner: str, repo: str, number: u256):
        owner, repo = owner.lower(), repo.lower()
        if not slug(owner, "-", 39) or not slug(repo, "-_.", 100) or number < 1 or number > 2147483647:
            raise gl.UserError("Use a public GitHub pull request.")

        def evidence():
            return inspect(owner, repo, int(number))

        proof = json.loads(gl.eq_principle.strict_eq(evidence))
        pull_key = str(proof["pull_id"])
        previous = self.latest.get(pull_key, "")
        if previous == "ISSUED" or previous == proof["result"]:
            raise gl.UserError("This pull request outcome is already recorded.")
        self.count = self.count + u256(1)
        self.latest[pull_key] = proof["result"]
        proof["nominator"] = str(gl.message.sender_address)
        self.records[self.count] = json.dumps(proof)
        if proof["result"] != "ISSUED":
            return
        author = str(proof["author_id"])
        stored = self.profiles.get(author, "")
        profile = json.loads(stored) if stored else {"proofs": 0, "owners": 0}
        profile["proofs"] += 1
        profile["author"] = proof["author"]
        owner_key = author + ":" + str(proof["owner_id"])
        if not self.credited_owners.get(owner_key, False):
            self.credited_owners[owner_key] = True
            profile["owners"] += 1
        profile["level"] = "MULTI_OWNER" if profile["owners"] > 1 else "MERGE_VERIFIED"
        self.profiles[author] = json.dumps(profile)
        self.profile_records[author + ":" + str(profile["proofs"])] = self.count
