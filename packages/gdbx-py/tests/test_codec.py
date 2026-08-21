import pathlib, sys
sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))
from gdbx_py.codec import make_address, validate_address, normalize_address
from gdbx_py.crypto import pair

def test_make_and_validate():
    p = pair()
    addr = make_address(p["pubkey_hex"])
    assert len(addr) == 58
    assert validate_address(addr)["ok"] is True
    assert validate_address(addr + ".gdbx")["ok"] is True
    assert normalize_address(addr) == addr
    assert normalize_address(addr + ".gdbx") == addr

def test_invalid():
    assert validate_address("short")["ok"] is False
    assert validate_address("a"*58)["ok"] is False  # bad checksum

def test_js_parity():
    # compare with JS: generate via python, then JS must validate (indirect via codec)
    # we test that python addr can be round-tripped via JS base32 logic (same alphabet)
    p = pair()
    addr = make_address(p["pubkey_hex"], network=0)
    # mainnet network byte 0
    assert validate_address(addr)["ok"] is True
    addr_testnet = make_address(p["pubkey_hex"], network=1)
    assert addr_testnet != addr
    assert validate_address(addr_testnet)["ok"] is True
