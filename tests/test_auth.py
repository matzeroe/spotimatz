from backend.auth import AuthStore


def test_setup_login_and_invite_flow(tmp_path) -> None:
    store = AuthStore(tmp_path / "auth.json")

    assert store.has_users() is False

    admin, admin_session = store.setup_admin("matze", "supersecret")
    assert admin.role == "admin"
    assert store.get_session_user(admin_session).username == "matze"
    assert store.has_users() is True

    invite = store.create_invite(admin.id, note="For living room tablet")
    assert invite["note"] == "For living room tablet"
    assert store.get_invite(invite["token"]) is not None
    assert store.get_invite(invite["token"])["note"] == "For living room tablet"

    guest, password = store.generate_invite_account(invite["token"])
    assert guest.role == "user"
    assert guest.username.startswith("user-")
    assert store.get_invite(invite["token"]) is None

    logged_in, login_session = store.login(guest.username, password)
    assert logged_in.id == guest.id
    assert store.get_session_user(login_session).id == guest.id


def test_invite_token_cannot_be_reused(tmp_path) -> None:
    store = AuthStore(tmp_path / "auth.json")
    admin, _ = store.setup_admin("admin", "adminsecret")
    invite = store.create_invite(admin.id)

    store.generate_invite_account(invite["token"])

    try:
        store.generate_invite_account(invite["token"])
    except ValueError as exc:
        assert "invalid or expired" in str(exc)
    else:
        raise AssertionError("Invite reuse should fail")


def test_admin_can_list_revoke_invites_and_delete_users(tmp_path) -> None:
    store = AuthStore(tmp_path / "auth.json")
    admin, _ = store.setup_admin("admin", "adminsecret")
    invite = store.create_invite(admin.id, note="temporary")
    guest, _ = store.generate_invite_account(invite["token"])
    open_invite = store.create_invite(admin.id, note="open")

    assert any(user["id"] == guest.id for user in store.list_users())
    assert any(item["token"] == open_invite["token"] for item in store.list_invites())

    store.revoke_invite(open_invite["token"])
    assert all(item["token"] != open_invite["token"] for item in store.list_invites())

    store.delete_user(guest.id, requested_by=admin.id)
    assert all(user["id"] != guest.id for user in store.list_users())
