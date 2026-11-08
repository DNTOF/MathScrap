//! Private session files.
//!
//! The token is written only after the directory's ACL or mode already excludes
//! other accounts. Nothing here prints the token. On Windows, SYSTEM and
//! Administrators remain in the ACL because that is the real privileged
//! boundary. The LocalAppData ancestor is never modified.

#![allow(unsafe_code)]

use std::fs;
use std::io::Read;
#[cfg(unix)]
use std::io::Write;
use std::path::Path;

#[derive(Clone, Copy)]
pub(crate) struct SecretError {
    pub code: &'static str,
    pub message: &'static str,
    status: u32,
    detail: &'static str,
}

impl SecretError {
    const fn new(code: &'static str, message: &'static str) -> Self {
        Self { code, message, status: 0, detail: "" }
    }

    #[cfg_attr(not(windows), allow(dead_code))]
    const fn with_status(mut self, status: u32) -> Self {
        self.status = status;
        self
    }

    #[cfg_attr(not(windows), allow(dead_code))]
    const fn with_detail(mut self, detail: &'static str) -> Self {
        self.detail = detail;
        self
    }

    pub(crate) const fn closed() -> Self {
        Self::new("mcp_closed", "MathScrap is not running.")
    }

    const fn acl() -> Self {
        Self::new("mcp_secret_acl", "The session file is not private to this user.")
    }

    const fn owner() -> Self {
        Self::new("mcp_secret_owner", "The session file is not owned by this user.")
    }

    const fn reparse() -> Self {
        Self::new("mcp_secret_reparse", "The session path is a reparse point.")
    }
}

impl std::fmt::Debug for SecretError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        if self.status == 0 && self.detail.is_empty() {
            write!(f, "{} ({})", self.code, self.message)
        } else {
            write!(f, "{} ({}) {} {:08x}", self.code, self.message, self.detail, self.status)
        }
    }
}

pub(crate) fn publish(dir: &Path, token: &str, endpoint: &str) -> Result<(), SecretError> {
    prepare_dir(dir)?;
    write_secret(&dir.join("session"), token.as_bytes())?;
    if let Err(err) = write_secret(&dir.join("endpoint"), endpoint.as_bytes()) {
        let _ = scrub(dir);
        return Err(err);
    }
    Ok(())
}

pub(crate) fn load(dir: &Path) -> Result<(String, String), SecretError> {
    if dir.as_os_str().is_empty() {
        return Err(SecretError::closed());
    }
    verify_dir(dir)?;
    let endpoint = read_secret(&dir.join("endpoint"))?;
    let token = read_secret(&dir.join("session"))?;
    let token = token.trim();
    if token.len() != 64 || !token.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(SecretError::closed());
    }
    Ok((endpoint, token.to_string()))
}

pub(crate) fn scrub(dir: &Path) -> Result<(), SecretError> {
    if dir.as_os_str().is_empty() {
        return Ok(());
    }
    match fs::symlink_metadata(dir) {
        Ok(meta) if reparse_point(&meta) => return Err(SecretError::reparse()),
        Ok(meta) if !meta.is_dir() => return Err(SecretError::reparse()),
        Ok(_) => {}
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(_) => return Err(SecretError::acl()),
    }
    for name in ["session", "endpoint"] {
        remove_secret(&dir.join(name))?;
    }
    Ok(())
}

fn reparse_point(meta: &fs::Metadata) -> bool {
    if meta.file_type().is_symlink() {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        // Junctions are reparse points and `is_symlink` is false for them.
        return meta.file_attributes() & 0x400 != 0;
    }
    #[cfg(not(windows))]
    {
        false
    }
}

fn is_app_folder(path: &Path) -> bool {
    matches!(path.file_name().and_then(|name| name.to_str()), Some("MathScrap" | "MathScrap-mcptest"))
}

fn prepare_dir(dir: &Path) -> Result<(), SecretError> {
    let parent = dir.parent().filter(|path| !path.as_os_str().is_empty()).ok_or_else(SecretError::acl)?;
    if fs::symlink_metadata(parent).map(|meta| reparse_point(&meta)).unwrap_or(false) {
        return Err(SecretError::reparse());
    }
    if !parent.exists() {
        create_private_dir(parent, is_app_folder(parent))?;
    } else if is_app_folder(parent) {
        // Our app folder only. LocalAppData and other ancestors stay as they are.
        lock_existing_dir(parent)?;
    }
    if fs::symlink_metadata(dir).map(|meta| reparse_point(&meta)).unwrap_or(false) {
        return Err(SecretError::reparse());
    }
    if fs::symlink_metadata(dir).is_err() {
        create_private_dir(dir, true)?;
    }
    lock_existing_dir(dir)?;
    verify_dir(dir)
}

#[cfg(unix)]
fn create_private_dir(path: &Path, _private: bool) -> Result<(), SecretError> {
    use std::os::unix::fs::DirBuilderExt;
    let mut builder = fs::DirBuilder::new();
    builder.mode(0o700);
    builder.create(path).map_err(|_| SecretError::acl())
}

#[cfg(unix)]
fn lock_existing_dir(path: &Path) -> Result<(), SecretError> {
    use std::os::unix::fs::OpenOptionsExt;
    if fs::symlink_metadata(path).map(|meta| meta.file_type().is_symlink()).unwrap_or(false) {
        return Err(SecretError::reparse());
    }
    let file = fs::OpenOptions::new().read(true).custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW).open(path).map_err(|_| SecretError::reparse())?;
    if unsafe { libc::fchmod(std::os::fd::AsRawFd::as_raw_fd(&file), 0o700) } != 0 {
        return Err(SecretError::acl());
    }
    verify_unix(&file, true)
}

#[cfg(unix)]
fn verify_dir(path: &Path) -> Result<(), SecretError> {
    use std::os::unix::fs::OpenOptionsExt;
    let file = fs::OpenOptions::new().read(true).custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW).open(path).map_err(|_| SecretError::reparse())?;
    verify_unix(&file, true)
}

#[cfg(unix)]
fn write_secret(path: &Path, bytes: &[u8]) -> Result<(), SecretError> {
    use std::os::fd::FromRawFd;
    use std::os::unix::ffi::OsStrExt;
    use std::os::unix::fs::OpenOptionsExt;
    if fs::symlink_metadata(path).map(|meta| meta.file_type().is_symlink()).unwrap_or(false) {
        remove_name(path)?;
    } else if fs::symlink_metadata(path).is_ok() {
        remove_name(path)?;
    }
    let c_path = std::ffi::CString::new(path.as_os_str().as_bytes()).map_err(|_| SecretError::acl())?;
    let flags = libc::O_RDWR | libc::O_CREAT | libc::O_EXCL | libc::O_NOFOLLOW | libc::O_CLOEXEC;
    let fd = unsafe { libc::open(c_path.as_ptr(), flags, 0o600) };
    if fd < 0 {
        return Err(SecretError::acl());
    }
    let mut file = unsafe { fs::File::from_raw_fd(fd) };
    if unsafe { libc::fchmod(fd, 0o600) } != 0 {
        let _ = remove_name(path);
        return Err(SecretError::acl());
    }
    verify_unix(&file, false)?;
    file.write_all(bytes).map_err(|_| SecretError::acl())?;
    drop(file);
    verify_unix(&fs::OpenOptions::new().read(true).custom_flags(libc::O_NOFOLLOW).open(path).map_err(|_| SecretError::acl())?, false)
}

#[cfg(unix)]
fn read_secret(path: &Path) -> Result<String, SecretError> {
    use std::os::unix::fs::OpenOptionsExt;
    let mut file = fs::OpenOptions::new().read(true).custom_flags(libc::O_NOFOLLOW).open(path).map_err(|_| SecretError::reparse())?;
    verify_unix(&file, false)?;
    read_capped(&mut file)
}

#[cfg(unix)]
fn verify_unix(file: &fs::File, directory: bool) -> Result<(), SecretError> {
    use std::os::fd::AsRawFd;
    let mut stat = unsafe { std::mem::zeroed::<libc::stat>() };
    if unsafe { libc::fstat(file.as_raw_fd(), &mut stat) } != 0 {
        return Err(SecretError::acl());
    }
    let kind = stat.st_mode & libc::S_IFMT;
    if directory {
        if kind != libc::S_IFDIR {
            return Err(SecretError::reparse());
        }
    } else if kind != libc::S_IFREG {
        return Err(SecretError::reparse());
    }
    if stat.st_uid != unsafe { libc::geteuid() } {
        return Err(SecretError::owner());
    }
    if stat.st_mode & 0o077 != 0 {
        return Err(SecretError::acl());
    }
    Ok(())
}

#[cfg(unix)]
fn remove_secret(path: &Path) -> Result<(), SecretError> {
    remove_name(path)
}

#[cfg(unix)]
fn remove_name(path: &Path) -> Result<(), SecretError> {
    match fs::symlink_metadata(path) {
        Ok(meta) if meta.is_dir() && !meta.file_type().is_symlink() => Err(SecretError::reparse()),
        Ok(_) => fs::remove_file(path).map_err(|_| SecretError::acl()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err(SecretError::acl()),
    }
}

fn read_capped(file: &mut fs::File) -> Result<String, SecretError> {
    let mut buf = [0u8; 256];
    let mut used = 0;
    loop {
        if used == buf.len() {
            let mut extra = [0u8; 1];
            let more = file.read(&mut extra).map_err(|_| SecretError::closed())?;
            if more > 0 {
                return Err(SecretError::closed());
            }
            break;
        }
        let n = file.read(&mut buf[used..]).map_err(|_| SecretError::closed())?;
        if n == 0 {
            break;
        }
        used += n;
    }
    String::from_utf8(buf[..used].to_vec()).map_err(|_| SecretError::closed())
}

#[cfg(windows)]
fn create_private_dir(path: &Path, private: bool) -> Result<(), SecretError> {
    if private {
        windows::create_dir_private(path)
    } else {
        fs::create_dir(path).map_err(|_| SecretError::acl())
    }
}

#[cfg(windows)]
fn lock_existing_dir(path: &Path) -> Result<(), SecretError> {
    windows::lock_dir(path)
}

#[cfg(windows)]
fn verify_dir(path: &Path) -> Result<(), SecretError> {
    windows::verify_path(path, true)
}

#[cfg(windows)]
fn write_secret(path: &Path, bytes: &[u8]) -> Result<(), SecretError> {
    windows::write_file(path, bytes)
}

#[cfg(windows)]
fn read_secret(path: &Path) -> Result<String, SecretError> {
    windows::read_file(path)
}

#[cfg(windows)]
fn remove_secret(path: &Path) -> Result<(), SecretError> {
    windows::remove_file(path)
}

#[cfg(windows)]
mod windows {
    use super::{read_capped, SecretError};
    use std::ffi::c_void;
    use std::fs::File;
    use std::os::windows::ffi::{OsStrExt, OsStringExt};
    use std::path::{Path, PathBuf};
    use std::ptr::null_mut;
    use std::fs;
    use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, LocalFree, ERROR_FILE_NOT_FOUND, ERROR_PATH_NOT_FOUND, ERROR_SUCCESS, HANDLE, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::Security::Authorization::{GetSecurityInfo, SetSecurityInfo, SE_FILE_OBJECT};
    use windows_sys::Win32::Security::{
        AddAccessAllowedAceEx, AllocateAndInitializeSid, CopySid, CreateWellKnownSid, EqualSid, FreeSid, GetAce, GetAclInformation, GetLengthSid, GetSecurityDescriptorControl, GetTokenInformation, InitializeAcl, InitializeSecurityDescriptor, MakeSelfRelativeSD, SetSecurityDescriptorControl, SetSecurityDescriptorDacl, AclSizeInformation, ACL_SIZE_INFORMATION, CONTAINER_INHERIT_ACE, DACL_SECURITY_INFORMATION, INHERITED_ACE, OBJECT_INHERIT_ACE, OWNER_SECURITY_INFORMATION, PROTECTED_DACL_SECURITY_INFORMATION, TokenUser, WinBuiltinAdministratorsSid, WinLocalSystemSid, ACL, ACL_REVISION, PSECURITY_DESCRIPTOR, PSID, SECURITY_ATTRIBUTES, SECURITY_DESCRIPTOR, SE_DACL_PRESENT, SE_DACL_PROTECTED, SID_IDENTIFIER_AUTHORITY, TOKEN_QUERY, TOKEN_USER, WELL_KNOWN_SID_TYPE,
    };
    use windows_sys::Win32::Storage::FileSystem::{
        CreateDirectoryW, CreateFileW, FlushFileBuffers, GetFileInformationByHandle, GetFileInformationByHandleEx, GetFinalPathNameByHandleW, SetFileInformationByHandle, WriteFile, BY_HANDLE_FILE_INFORMATION, CREATE_NEW, FILE_ATTRIBUTE_NORMAL, FILE_ATTRIBUTE_REPARSE_POINT, FILE_ATTRIBUTE_TAG_INFO, FILE_DISPOSITION_INFO, FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT, FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE, FileAttributeTagInfo, FileDispositionInfo, OPEN_EXISTING, READ_CONTROL, SYNCHRONIZE, WRITE_DAC,
    };
    use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

    const FILE_READ_DATA: u32 = 0x0001;
    const FILE_WRITE_DATA: u32 = 0x0002;
    const FILE_APPEND_DATA: u32 = 0x0004;
    const FILE_READ_ATTRIBUTES: u32 = 0x0080;
    const FILE_WRITE_ATTRIBUTES: u32 = 0x0100;
    const FILE_LIST_DIRECTORY: u32 = 0x0001;
    const FILE_ADD_FILE: u32 = 0x0002;
    const FILE_ADD_SUBDIRECTORY: u32 = 0x0004;
    const FILE_DELETE_CHILD: u32 = 0x0040;
    const DELETE: u32 = 0x00010000;
    const FILE_ALL_ACCESS: u32 = 0x001F01FF;
    const ACCESS_ALLOWED_ACE_TYPE: u8 = 0;

    struct Owned(HANDLE);

    impl Drop for Owned {
        fn drop(&mut self) {
            if !self.0.is_null() && self.0 != INVALID_HANDLE_VALUE {
                unsafe { CloseHandle(self.0) };
            }
        }
    }

    struct Local(*mut c_void);

    impl Drop for Local {
        fn drop(&mut self) {
            if !self.0.is_null() {
                unsafe { LocalFree(self.0 as *mut _) };
            }
        }
    }

    #[repr(C, align(8))]
    struct AclBuf {
        bytes: [u8; 768],
    }

    struct Identity {
        user: Vec<u8>,
        system: Vec<u8>,
        admins: Vec<u8>,
    }

    pub(super) fn create_dir_private(path: &Path) -> Result<(), SecretError> {
        let parent = path.parent().ok_or_else(SecretError::acl)?;
        let root = open_existing(parent, true)?;
        if is_reparse(root.0)? {
            return Err(SecretError::reparse());
        }
        let id = identity()?;
        let mut sd = relative_sd(&id, true)?;
        let wide = wide_path(path);
        let sa = SECURITY_ATTRIBUTES {
            nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: sd.as_mut_ptr() as *mut c_void,
            bInheritHandle: 0,
        };
        // CreateDirectory applies the descriptor as the directory is created. CreateFile cannot create a directory.
        if unsafe { CreateDirectoryW(wide.as_ptr(), &sa) } == 0 {
            return Err(SecretError::acl().with_status(unsafe { GetLastError() }).with_detail("create-dir"));
        }
        let handle = match open_existing(path, true) {
            Ok(handle) => handle,
            Err(err) => return Err(err),
        };
        if is_reparse(handle.0).unwrap_or(true) || !same_directory(root.0, handle.0).unwrap_or(false) {
            let _ = delete_handle(handle.0);
            return Err(SecretError::reparse());
        }
        if let Err(err) = verify_handle(handle.0, &id, true) {
            let _ = delete_handle(handle.0);
            return Err(err);
        }
        Ok(())
    }

    pub(super) fn lock_dir(path: &Path) -> Result<(), SecretError> {
        let handle = open_existing(path, true)?;
        if is_reparse(handle.0)? {
            return Err(SecretError::reparse());
        }
        let id = identity()?;
        apply_private(handle.0, &id, true)?;
        verify_handle(handle.0, &id, true)
    }

    pub(super) fn verify_path(path: &Path, directory: bool) -> Result<(), SecretError> {
        let handle = open_existing(path, directory)?;
        if is_reparse(handle.0)? {
            return Err(SecretError::reparse());
        }
        verify_handle(handle.0, &identity()?, directory)
    }

    pub(super) fn write_file(path: &Path, bytes: &[u8]) -> Result<(), SecretError> {
        let parent = path.parent().ok_or_else(SecretError::acl)?;
        let name = path.file_name().and_then(|text| text.to_str()).ok_or_else(SecretError::acl)?;
        let dir = open_existing(parent, true)?;
        if is_reparse(dir.0)? {
            return Err(SecretError::reparse());
        }
        let id = identity()?;
        verify_handle(dir.0, &id, true)?;
        let child = parent.join(name);
        match remove_existing(&child) {
            Ok(()) | Err(SecretError { code: "mcp_closed", .. }) => {}
            Err(err) => return Err(err),
        }
        let sd = relative_sd(&id, false)?;
        let handle = create_new(&child, false, &sd)?;
        if is_reparse(handle.0).unwrap_or(true) || !same_directory(dir.0, handle.0).unwrap_or(false) {
            let _ = delete_handle(handle.0);
            return Err(SecretError::reparse());
        }
        if let Err(err) = verify_handle(handle.0, &id, false) {
            let _ = delete_handle(handle.0);
            return Err(err);
        }
        if let Err(err) = write_all(handle.0, bytes) {
            let _ = delete_handle(handle.0);
            return Err(err);
        }
        if let Err(err) = verify_handle(handle.0, &id, false) {
            let _ = delete_handle(handle.0);
            return Err(err);
        }
        Ok(())
    }

    pub(super) fn read_file(path: &Path) -> Result<String, SecretError> {
        let parent = path.parent().ok_or_else(SecretError::acl)?;
        let name = path.file_name().and_then(|text| text.to_str()).ok_or_else(SecretError::acl)?;
        let dir = open_existing(parent, true)?;
        if is_reparse(dir.0)? {
            return Err(SecretError::reparse());
        }
        let id = identity()?;
        verify_handle(dir.0, &id, true)?;
        let handle = open_existing(&parent.join(name), false)?;
        if is_reparse(handle.0)? || !same_directory(dir.0, handle.0)? {
            return Err(SecretError::reparse());
        }
        verify_handle(handle.0, &id, false)?;
        read_handle(handle.0)
    }

    pub(super) fn remove_file(path: &Path) -> Result<(), SecretError> {
        let Some(parent) = path.parent() else {
            return Ok(());
        };
        let Some(name) = path.file_name().and_then(|text| text.to_str()) else {
            return Ok(());
        };
        let dir = match open_existing(parent, true) {
            Ok(handle) => handle,
            Err(SecretError { code: "mcp_closed", .. }) => return Ok(()),
            Err(err) => return Err(err),
        };
        if is_reparse(dir.0)? {
            return Err(SecretError::reparse());
        }
        match remove_existing(&parent.join(name)) {
            Err(SecretError { code: "mcp_closed", .. }) => Ok(()),
            other => other,
        }
    }

    fn open_existing(path: &Path, directory: bool) -> Result<Owned, SecretError> {
        let wide = wide_path(path);
        let handle = unsafe { CreateFileW(wide.as_ptr(), access_mask(directory), FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, null_mut(), OPEN_EXISTING, open_flags(directory), null_mut()) };
        if handle.is_null() || handle == INVALID_HANDLE_VALUE {
            let err = unsafe { GetLastError() };
            return Err(if err == ERROR_FILE_NOT_FOUND || err == ERROR_PATH_NOT_FOUND {
                SecretError::closed()
            } else {
                SecretError::acl().with_status(err).with_detail("open")
            });
        }
        Ok(Owned(handle))
    }

    fn create_new(path: &Path, directory: bool, sd: &[u8]) -> Result<Owned, SecretError> {
        let wide = wide_path(path);
        let mut owned = sd.to_vec();
        let sa = SECURITY_ATTRIBUTES {
            nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: owned.as_mut_ptr() as *mut c_void,
            bInheritHandle: 0,
        };
        let handle = unsafe { CreateFileW(wide.as_ptr(), access_mask(directory), FILE_SHARE_READ | FILE_SHARE_DELETE, &sa, CREATE_NEW, open_flags(directory), null_mut()) };
        if handle.is_null() || handle == INVALID_HANDLE_VALUE {
            return Err(SecretError::acl().with_status(unsafe { GetLastError() }).with_detail("create"));
        }
        Ok(Owned(handle))
    }

    fn access_mask(directory: bool) -> u32 {
        let common = FILE_READ_ATTRIBUTES | FILE_WRITE_ATTRIBUTES | READ_CONTROL | WRITE_DAC | DELETE | SYNCHRONIZE;
        if directory {
            FILE_LIST_DIRECTORY | FILE_ADD_FILE | FILE_ADD_SUBDIRECTORY | FILE_DELETE_CHILD | common
        } else {
            FILE_READ_DATA | FILE_WRITE_DATA | FILE_APPEND_DATA | common
        }
    }

    fn open_flags(directory: bool) -> u32 {
        let kind = if directory { 0x00000010 } else { FILE_ATTRIBUTE_NORMAL };
        kind | FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT
    }

    fn wide_path(path: &Path) -> Vec<u16> {
        let raw: Vec<u16> = path.as_os_str().encode_wide().collect();
        let mut out = Vec::with_capacity(raw.len() + 5);
        let prefixed = raw.len() >= 4 && raw[0] == '\\' as u16 && raw[1] == '\\' as u16 && (raw[2] == '?' as u16 || raw[2] == '.' as u16);
        let drive = raw.len() >= 3 && raw[1] == ':' as u16;
        if !prefixed && drive {
            out.extend(['\\' as u16, '\\' as u16, '?' as u16, '\\' as u16]);
        }
        out.extend(raw);
        out.push(0);
        out
    }

    fn is_reparse(handle: HANDLE) -> Result<bool, SecretError> {
        let mut info = FILE_ATTRIBUTE_TAG_INFO { FileAttributes: 0, ReparseTag: 0 };
        let ok = unsafe { GetFileInformationByHandleEx(handle, FileAttributeTagInfo, &mut info as *mut _ as *mut c_void, std::mem::size_of::<FILE_ATTRIBUTE_TAG_INFO>() as u32) };
        if ok == 0 {
            return Err(SecretError::acl().with_status(unsafe { GetLastError() }).with_detail("reparse-query"));
        }
        Ok(info.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT != 0)
    }

    fn delete_handle(handle: HANDLE) -> Result<(), SecretError> {
        let info = FILE_DISPOSITION_INFO { DeleteFile: 1 };
        let ok = unsafe { SetFileInformationByHandle(handle, FileDispositionInfo, &info as *const _ as *const c_void, std::mem::size_of::<FILE_DISPOSITION_INFO>() as u32) };
        if ok == 0 {
            return Err(SecretError::acl().with_status(unsafe { GetLastError() }).with_detail("delete"));
        }
        Ok(())
    }

    fn remove_existing(path: &Path) -> Result<(), SecretError> {
        if fs::symlink_metadata(path).is_err() {
            return Ok(());
        }
        let wide = wide_path(path);
        let handle = unsafe { CreateFileW(wide.as_ptr(), DELETE | FILE_READ_ATTRIBUTES | SYNCHRONIZE, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, null_mut(), OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT, null_mut()) };
        if handle.is_null() || handle == INVALID_HANDLE_VALUE {
            let err = unsafe { GetLastError() };
            return Err(if err == ERROR_FILE_NOT_FOUND || err == ERROR_PATH_NOT_FOUND { SecretError::closed() } else { SecretError::acl().with_status(err).with_detail("replace") });
        }
        let owned = Owned(handle);
        if is_reparse(owned.0)? {
            return delete_handle(owned.0);
        }
        if fs::symlink_metadata(path).map(|meta| meta.is_dir()).unwrap_or(false) {
            return Err(SecretError::reparse());
        }
        delete_handle(owned.0)
    }

    fn same_directory(parent: HANDLE, child: HANDLE) -> Result<bool, SecretError> {
        let expected = file_id(parent)?;
        let path = final_path(child)?;
        let Some(parent_path) = path.parent() else {
            return Ok(false);
        };
        let opened = open_existing(parent_path, true)?;
        if is_reparse(opened.0)? {
            return Ok(false);
        }
        Ok(file_id(opened.0)? == expected)
    }

    fn file_id(handle: HANDLE) -> Result<(u32, u32, u32), SecretError> {
        let mut info = unsafe { std::mem::zeroed::<BY_HANDLE_FILE_INFORMATION>() };
        if unsafe { GetFileInformationByHandle(handle, &mut info) } == 0 {
            return Err(SecretError::acl().with_status(unsafe { GetLastError() }).with_detail("file-id"));
        }
        Ok((info.dwVolumeSerialNumber, info.nFileIndexHigh, info.nFileIndexLow))
    }

    fn final_path(handle: HANDLE) -> Result<PathBuf, SecretError> {
        let mut buf = vec![0u16; 1024];
        let length = unsafe { GetFinalPathNameByHandleW(handle, buf.as_mut_ptr(), buf.len() as u32, 0) };
        if length == 0 || length as usize >= buf.len() {
            return Err(SecretError::acl().with_status(unsafe { GetLastError() }).with_detail("final-path"));
        }
        buf.truncate(length as usize);
        Ok(PathBuf::from(std::ffi::OsString::from_wide(&buf)))
    }

    fn write_all(handle: HANDLE, bytes: &[u8]) -> Result<(), SecretError> {
        let mut written = 0u32;
        let ok = unsafe { WriteFile(handle, bytes.as_ptr(), bytes.len() as u32, &mut written, null_mut()) };
        if ok == 0 || written as usize != bytes.len() {
            let _ = delete_handle(handle);
            return Err(SecretError::acl());
        }
        unsafe { FlushFileBuffers(handle) };
        Ok(())
    }

    fn read_handle(handle: HANDLE) -> Result<String, SecretError> {
        use std::os::windows::io::{FromRawHandle, RawHandle};
        let mut file = unsafe { File::from_raw_handle(handle as RawHandle) };
        let text = read_capped(&mut file);
        std::mem::forget(file);
        text
    }

    fn fill_acl(acl: &mut AclBuf, id: &Identity, directory: bool) -> Result<(), SecretError> {
        let acl_ptr = acl.bytes.as_mut_ptr() as *mut ACL;
        if unsafe { InitializeAcl(acl_ptr, acl.bytes.len() as u32, ACL_REVISION) } == 0 {
            return Err(SecretError::acl().with_detail("acl-init"));
        }
        let flags = if directory { OBJECT_INHERIT_ACE | CONTAINER_INHERIT_ACE } else { 0 };
        for sid in [&id.user, &id.system, &id.admins] {
            if unsafe { AddAccessAllowedAceEx(acl_ptr, ACL_REVISION, flags, FILE_ALL_ACCESS, sid.as_ptr() as PSID) } == 0 {
                return Err(SecretError::acl().with_detail("acl-ace"));
            }
        }
        Ok(())
    }

    fn relative_sd(id: &Identity, directory: bool) -> Result<Vec<u8>, SecretError> {
        let mut acl = Box::new(AclBuf { bytes: [0; 768] });
        fill_acl(&mut acl, id, directory)?;
        let mut descriptor = unsafe { std::mem::zeroed::<SECURITY_DESCRIPTOR>() };
        let sd_ptr = &mut descriptor as *mut SECURITY_DESCRIPTOR as PSECURITY_DESCRIPTOR;
        if unsafe { InitializeSecurityDescriptor(sd_ptr, 1) } == 0 {
            return Err(SecretError::acl().with_detail("sd-init"));
        }
        if unsafe { SetSecurityDescriptorDacl(sd_ptr, 1, acl.bytes.as_mut_ptr() as *mut ACL, 0) } == 0 {
            return Err(SecretError::acl().with_detail("sd-dacl"));
        }
        if unsafe { SetSecurityDescriptorControl(sd_ptr, SE_DACL_PROTECTED, SE_DACL_PROTECTED) } == 0 {
            return Err(SecretError::acl().with_detail("sd-protect"));
        }
        descriptor.Control |= SE_DACL_PROTECTED;
        let mut bytes = 0u32;
        unsafe { MakeSelfRelativeSD(sd_ptr, null_mut(), &mut bytes) };
        if bytes == 0 {
            return Err(SecretError::acl().with_status(unsafe { GetLastError() }).with_detail("sd-size"));
        }
        let mut buf = vec![0u8; bytes as usize];
        if unsafe { MakeSelfRelativeSD(sd_ptr, buf.as_mut_ptr() as PSECURITY_DESCRIPTOR, &mut bytes) } == 0 {
            return Err(SecretError::acl().with_status(unsafe { GetLastError() }).with_detail("sd-relative"));
        }
        buf.truncate(bytes as usize);
        Ok(buf)
    }

    fn apply_private(handle: HANDLE, id: &Identity, directory: bool) -> Result<(), SecretError> {
        let mut acl = AclBuf { bytes: [0; 768] };
        fill_acl(&mut acl, id, directory)?;
        let code = unsafe { SetSecurityInfo(handle, SE_FILE_OBJECT, DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION, null_mut(), null_mut(), acl.bytes.as_mut_ptr() as *mut ACL, null_mut()) };
        if code != ERROR_SUCCESS {
            return Err(SecretError::acl().with_status(code).with_detail("set-dacl"));
        }
        Ok(())
    }

    fn verify_handle(handle: HANDLE, id: &Identity, _directory: bool) -> Result<(), SecretError> {
        let mut owner: PSID = null_mut();
        let mut dacl = null_mut();
        let mut sd: PSECURITY_DESCRIPTOR = null_mut();
        let code = unsafe { GetSecurityInfo(handle, SE_FILE_OBJECT, OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION, &mut owner, null_mut(), &mut dacl, null_mut(), &mut sd) };
        if code != ERROR_SUCCESS {
            return Err(SecretError::acl());
        }
        let _sd = Local(sd as *mut c_void);
        let owners = [&id.user, &id.system, &id.admins];
        if owner.is_null() || !owners.iter().any(|sid| unsafe { EqualSid(owner, sid.as_ptr() as PSID) } != 0) {
            return Err(SecretError::owner());
        }
        let mut control = 0u16;
        let mut revision = 0u32;
        if unsafe { GetSecurityDescriptorControl(sd, &mut control, &mut revision) } == 0 {
            return Err(SecretError::acl().with_detail("control"));
        }
        if control & SE_DACL_PRESENT == 0 || control & SE_DACL_PROTECTED == 0 || dacl.is_null() {
            return Err(SecretError::acl().with_detail("protected"));
        }
        let mut info = ACL_SIZE_INFORMATION { AceCount: 0, AclBytesInUse: 0, AclBytesFree: 0 };
        if unsafe { GetAclInformation(dacl, &mut info as *mut _ as *mut c_void, std::mem::size_of::<ACL_SIZE_INFORMATION>() as u32, AclSizeInformation) } == 0 {
            return Err(SecretError::acl());
        }
        if info.AceCount == 0 {
            return Err(SecretError::acl());
        }
        for index in 0..info.AceCount {
            let mut ace = null_mut();
            if unsafe { GetAce(dacl, index, &mut ace) } == 0 {
                return Err(SecretError::acl());
            }
            let header = unsafe { &*(ace as *const AceHeader) };
            if header.ace_type != ACCESS_ALLOWED_ACE_TYPE || header.ace_flags & INHERITED_ACE as u8 != 0 {
                return Err(SecretError::acl().with_detail("ace"));
            }
            let sid = unsafe { (ace as *mut u8).add(std::mem::size_of::<AceHeader>() + 4) as PSID };
            let allowed = [&id.user, &id.system, &id.admins];
            if !allowed.iter().any(|want| unsafe { EqualSid(sid, want.as_ptr() as PSID) } != 0) {
                return Err(SecretError::acl().with_detail("ace"));
            }
        }
        Ok(())
    }

    #[repr(C)]
    struct AceHeader {
        ace_type: u8,
        ace_flags: u8,
        ace_size: u16,
    }

    fn identity() -> Result<Identity, SecretError> {
        Ok(Identity { user: current_user()?, system: well_known(WinLocalSystemSid)?, admins: well_known(WinBuiltinAdministratorsSid)? })
    }

    fn current_user() -> Result<Vec<u8>, SecretError> {
        let mut token: HANDLE = null_mut();
        if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) } == 0 {
            return Err(SecretError::acl());
        }
        let _token = Owned(token);
        let mut len = 0u32;
        unsafe { GetTokenInformation(token, TokenUser, null_mut(), 0, &mut len) };
        if len == 0 {
            return Err(SecretError::acl());
        }
        let mut buf = vec![0u8; len as usize];
        if unsafe { GetTokenInformation(token, TokenUser, buf.as_mut_ptr() as *mut c_void, len, &mut len) } == 0 {
            return Err(SecretError::acl());
        }
        let user = unsafe { &*(buf.as_ptr() as *const TOKEN_USER) };
        let sid_len = unsafe { GetLengthSid(user.User.Sid) } as usize;
        let mut sid = vec![0u8; sid_len];
        if unsafe { CopySid(sid_len as u32, sid.as_mut_ptr() as PSID, user.User.Sid) } == 0 {
            return Err(SecretError::acl());
        }
        Ok(sid)
    }

    fn well_known(kind: WELL_KNOWN_SID_TYPE) -> Result<Vec<u8>, SecretError> {
        let mut sid = vec![0u8; 68];
        let mut len = sid.len() as u32;
        if unsafe { CreateWellKnownSid(kind, null_mut(), sid.as_mut_ptr() as PSID, &mut len) } == 0 {
            return Err(SecretError::acl());
        }
        sid.truncate(len as usize);
        Ok(sid)
    }

    #[cfg(test)]
    pub(super) fn foreign_sid() -> Vec<u8> {
        let authority = SID_IDENTIFIER_AUTHORITY { Value: [0, 0, 0, 0, 0, 5] };
        let mut sid: PSID = null_mut();
        let ok = unsafe { AllocateAndInitializeSid(&authority, 5, 21, 9, 8, 7, 1001, 0, 0, 0, &mut sid) };
        assert!(ok != 0, "the foreign SID fixture was not created");
        let len = unsafe { GetLengthSid(sid) } as usize;
        let mut bytes = vec![0u8; len];
        assert!(unsafe { CopySid(len as u32, bytes.as_mut_ptr() as PSID, sid) } != 0);
        unsafe { FreeSid(sid) };
        bytes
    }

    #[cfg(test)]
    pub(super) fn grant_inheritable(path: &Path, foreign: &[u8]) {
        let id = identity().expect("identity");
        let mut acl = AclBuf { bytes: [0; 768] };
        let acl_ptr = acl.bytes.as_mut_ptr() as *mut ACL;
        assert!(unsafe { InitializeAcl(acl_ptr, acl.bytes.len() as u32, ACL_REVISION) } != 0);
        let flags = OBJECT_INHERIT_ACE | CONTAINER_INHERIT_ACE;
        for sid in [&id.user, &id.system, &id.admins, foreign] {
            assert!(unsafe { AddAccessAllowedAceEx(acl_ptr, ACL_REVISION, flags, FILE_ALL_ACCESS, sid.as_ptr() as PSID) } != 0, "fixture ACE");
        }
        let directory = fs::metadata(path).map(|meta| meta.is_dir()).unwrap_or(false);
        let handle = open_existing(path, directory).expect("fixture object");
        let code = unsafe { SetSecurityInfo(handle.0, SE_FILE_OBJECT, DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION, null_mut(), null_mut(), acl_ptr, null_mut()) };
        assert_eq!(code, ERROR_SUCCESS, "fixture DACL was not installed");
    }

    #[cfg(test)]
    pub(super) fn allows_sid(path: &Path, foreign: &[u8]) -> bool {
        let Ok(handle) = open_existing(path, fs::metadata(path).map(|meta| meta.is_dir()).unwrap_or(false)) else {
            return false;
        };
        let mut dacl = null_mut();
        let mut sd: PSECURITY_DESCRIPTOR = null_mut();
        let code = unsafe { GetSecurityInfo(handle.0, SE_FILE_OBJECT, DACL_SECURITY_INFORMATION, null_mut(), null_mut(), &mut dacl, null_mut(), &mut sd) };
        if code != ERROR_SUCCESS {
            return false;
        }
        let _sd = Local(sd as *mut c_void);
        if dacl.is_null() {
            return true;
        }
        let mut info = ACL_SIZE_INFORMATION { AceCount: 0, AclBytesInUse: 0, AclBytesFree: 0 };
        if unsafe { GetAclInformation(dacl, &mut info as *mut _ as *mut c_void, std::mem::size_of::<ACL_SIZE_INFORMATION>() as u32, AclSizeInformation) } == 0 {
            return false;
        }
        for index in 0..info.AceCount {
            let mut ace = null_mut();
            if unsafe { GetAce(dacl, index, &mut ace) } == 0 {
                continue;
            }
            let header = unsafe { &*(ace as *const AceHeader) };
            if header.ace_type != ACCESS_ALLOWED_ACE_TYPE {
                continue;
            }
            let sid = unsafe { (ace as *mut u8).add(std::mem::size_of::<AceHeader>() + 4) as PSID };
            if unsafe { EqualSid(sid, foreign.as_ptr() as PSID) } != 0 {
                return true;
            }
        }
        false
    }

}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn token(byte: u8) -> String {
        format!("{byte:02x}").repeat(32)
    }

    fn endpoint() -> String {
        "http://127.0.0.1:47323/mcp".to_string()
    }

    fn temp() -> PathBuf {
        let mut bytes = [0u8; 8];
        getrandom::fill(&mut bytes).unwrap();
        let name: String = bytes.iter().map(|byte| format!("{byte:02x}")).collect();
        let path = std::env::temp_dir().join(format!("mathscrap-secret-{name}"));
        fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn permissive_parent_cannot_read_and_close_removes_the_files() {
        let root = temp();
        let app = root.join("MathScrap-mcptest");
        fs::create_dir(&app).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&app, fs::Permissions::from_mode(0o777)).unwrap();
        }
        #[cfg(unix)]
        let root_mode = {
            use std::os::unix::fs::PermissionsExt;
            fs::symlink_metadata(&root).unwrap().permissions().mode()
        };
        let dir = app.join("mcp");
        let first = token(0x11);
        let second = token(0x22);
        publish(&dir, &first, &endpoint()).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(fs::symlink_metadata(&app).unwrap().permissions().mode() & 0o077, 0, "app folder stayed group-writable");
            assert_eq!(fs::symlink_metadata(&dir).unwrap().permissions().mode() & 0o077, 0, "secret directory is not private");
            assert_eq!(fs::symlink_metadata(dir.join("session")).unwrap().permissions().mode() & 0o077, 0, "session mode is not private");
            assert_eq!(fs::symlink_metadata(&root).unwrap().permissions().mode(), root_mode, "ancestor mode changed");
        }
        let (got_endpoint, got) = load(&dir).unwrap();
        assert!(got == first && got_endpoint == endpoint(), "private read did not return the written session");
        publish(&dir, &second, &endpoint()).unwrap();
        let (_, rotated) = load(&dir).unwrap();
        assert!(rotated == second && rotated != first, "restart did not rotate the session");
        scrub(&dir).unwrap();
        assert!(load(&dir).is_err(), "scrub left a usable session");
        assert!(!dir.join("session").exists());
        assert!(!dir.join("endpoint").exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[cfg(unix)]
    #[test]
    fn helper_refuses_a_swapped_symlink() {
        let root = temp();
        let dir = root.join("mcp");
        publish(&dir, &token(0x33), &endpoint()).unwrap();
        let outside = root.join("outside");
        fs::write(&outside, token(0x44)).unwrap();
        fs::remove_file(dir.join("session")).unwrap();
        std::os::unix::fs::symlink(&outside, dir.join("session")).unwrap();
        let err = load(&dir).unwrap_err();
        assert_eq!(err.code, "mcp_secret_reparse");
        assert!(!format!("{err:?}").contains(&token(0x44)), "symlink rejection included secret bytes");
        let outside_bytes = fs::read(&outside).unwrap();
        publish(&dir, &token(0x33), &endpoint()).unwrap();
        assert_eq!(fs::read(&outside).unwrap(), outside_bytes, "replacing a symlink wrote through it");
        let linked = root.join("linked-parent");
        std::os::unix::fs::symlink(&root, &linked).unwrap();
        let err = publish(&linked.join("nested"), &token(0x55), &endpoint()).unwrap_err();
        assert_eq!(err.code, "mcp_secret_reparse");
        assert!(!root.join("nested").join("session").exists(), "publish followed a parent symlink");
        let _ = fs::remove_dir_all(&root);
    }

    #[cfg(windows)]
    #[test]
    fn inherited_foreign_ace_never_reaches_the_session() {
        let root = temp();
        let foreign = windows::foreign_sid();
        windows::grant_inheritable(&root, &foreign);
        let probe = root.join("inherited-probe.txt");
        fs::write(&probe, b"probe").unwrap();
        assert!(windows::allows_sid(&probe, &foreign), "the fixture did not inherit the foreign ACE");
        let app = root.join("MathScrap-mcptest");
        fs::create_dir(&app).unwrap();
        assert!(windows::allows_sid(&app, &foreign), "the app folder did not inherit the foreign ACE");
        let dir = app.join("mcp");
        publish(&dir, &token(0x66), &endpoint()).unwrap();
        assert!(windows::allows_sid(&root, &foreign), "the ancestor ACL was modified");
        assert!(windows::allows_sid(&probe, &foreign), "an ancestor file was modified");
        assert!(!windows::allows_sid(&app, &foreign), "the app folder kept the foreign ACE");
        assert!(!windows::allows_sid(&dir, &foreign), "the secret directory kept the foreign ACE");
        assert!(!windows::allows_sid(&dir.join("session"), &foreign), "the session kept the foreign ACE");
        assert!(!windows::allows_sid(&dir.join("endpoint"), &foreign), "the endpoint kept the foreign ACE");
        let _ = load(&dir).expect("owner read of a private session");
        windows::grant_inheritable(&dir.join("session"), &foreign);
        let err = load(&dir).unwrap_err();
        assert_eq!(err.code, "mcp_secret_acl");
        assert!(!format!("{err:?}").contains(&token(0x66)), "rejection included the token");
        let real = root.join("real-target");
        fs::create_dir(&real).unwrap();
        let link = root.join("mcp-link");
        let created = std::process::Command::new("cmd.exe").arg("/c").arg("mklink").arg("/J").arg(&link).arg(&real).status().expect("junction");
        assert!(created.success(), "the reparse fixture was not created");
        let err = publish(&link, &token(0x77), &endpoint());
        assert!(err.is_err(), "a reparse session directory was accepted");
        assert_eq!(err.unwrap_err().code, "mcp_secret_reparse");
        assert!(!real.join("session").exists(), "publish followed a directory reparse point");
        let _ = fs::remove_dir(&link);
        scrub(&dir).unwrap();
        assert!(load(&dir).is_err(), "close left a usable session");
        let _ = fs::remove_dir_all(&root);
    }
}
