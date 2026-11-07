# v0.0.1 公开签名材料

# v0.0.1 public signing material

这些是本机发行钥匙的公钥和指纹。私钥留在签名那台机器上，不进入仓库，也不注册到 GitHub 账户。

These are the public keys and fingerprints for the machine that signs this release. Private keys stay on that machine. They are not in the repository and they are not added to the GitHub account.

Git 提交和 annotated tag 使用 GPG Ed25519 `13E203AC53D88778AD69A9361EC5DC0B3EDBB23E`。UID 是 `DNT_OF`，没有邮箱。因此这把钥匙的有效签名不能写成 GitHub Verified。已在 `main` 上的三个提交保持原样，这个新提交不回头补签它们。

Git commits and the annotated tag use GPG Ed25519 `13E203AC53D88778AD69A9361EC5DC0B3EDBB23E`. The UID is `DNT_OF` and it has no email address, so a valid signature from this key is not GitHub Verified. The three commits already on `main` stay as they are. This new commit does not re-sign them.

Android 正式证书 SHA-256 是 `3D0E7FCAFEACF781628A29DE1D7EBCC7E2FEE58CC14A9F0D258C06776CE5F690`，alias `mathscrap-release`。它不是 CI 的 Android debug 证书。

The Android release certificate SHA-256 is `3D0E7FCAFEACF781628A29DE1D7EBCC7E2FEE58CC14A9F0D258C06776CE5F690`, alias `mathscrap-release`. It is not the CI Android debug certificate.

Windows 自签代码签名证书 SHA-256 是 `62B307F926AFE2641E306A557ACB0260A9159DA0A404A738298F01C5EC4F9F1F`。CurrentUser\My 指纹是 `75F97DC8735195D8E04A254FA906B4E1003AA65A`。系统会显示不受信任，这是预期结果。

The Windows self-signed code-signing certificate SHA-256 is `62B307F926AFE2641E306A557ACB0260A9159DA0A404A738298F01C5EC4F9F1F`. The CurrentUser\My thumbprint is `75F97DC8735195D8E04A254FA906B4E1003AA65A`. An untrusted-root warning is expected.

`SHA256SUMS` 覆盖同目录的三个公钥文件。

`SHA256SUMS` covers the three public files in this directory.
