import json, pathlib, sys
sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))
from gdbx_py.crypto import pair, sign, verify, canonical_json

def test_pair_and_sign_verify():
    p = pair()
    body = {"addr": "aeaqtest123456789012345678901234567890123456789012345678", "action": "sync.put", "ts": 123, "payload": "[]"}
    sig = sign(body, p)
    assert sig.startswith("GDBx")
    assert verify(body, sig, p["pub"]) is True

def test_tamper_fails():
    p = pair()
    body = {"addr": "a", "action": "x", "ts": 1, "payload": "y"}
    sig = sign(body, p)
    body2 = {"addr": "a", "action": "x", "ts": 1, "payload": "z"}
    assert verify(body2, sig, p["pub"]) is False

def test_js_vector():
    vec = json.loads(pathlib.Path("../../test/vectors/gdbx-vectors-js.json").read_text() if pathlib.Path("../../test/vectors/gdbx-vectors-js.json").exists() else pathlib.Path("test/vectors/gdbx-vectors-js.json").read_text())
    # fallback path
    try:
        p = pathlib.Path("test/vectors/gdbx-vectors-js.json")
        if not p.exists():
            p = pathlib.Path("../../test/vectors/gdbx-vectors-js.json")
        if not p.exists():
            p = pathlib.Path("D:/OpenCodeWEBsUI/OpenCodeWEB/GDBX/test/vectors/gdbx-vectors-js.json")
        vec = json.loads(p.read_text())
    except Exception as e:
        assert False, str(e)
    for v in vec["vectors"]:
        assert verify(v["body"], v["sig"], v["pub"]) == v["valid"]

def test_canonical_sorted():
    a = {"b": 2, "a": 1}
    b = {"a": 1, "b": 2}
    assert canonical_json(a) == canonical_json(b)
    assert canonical_json(a) == '{"a":1,"b":2}'
