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
}

impl SecretError {
    const fn new(code: &'static str, message: &'static str) -> Self {
        Self { code, message }
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
        write!(f, "{} ({})", self.code, self.message)
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
    use std::os::windows::ffi::OsStrExt;
    use std::path::Path;
    use std::ptr::null_mut;
    use std::fs;
    use windows_sys::Win32::Foundation::{CloseHandle, LocalFree, ERROR_SUCCESS, HANDLE, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::Security::Authorization::{GetSecurityInfo, SetSecurityInfo, SE_FILE_OBJECT};
    use windows_sys::Win32::Security::{
        AddAccessAllowedAceEx, AllocateAndInitializeSid, CopySid, CreateWellKnownSid, EqualSid, FreeSid, GetAce, GetAclInformation, GetLengthSid, GetSecurityDescriptorControl, GetTokenInformation, InitializeAcl, InitializeSecurityDescriptor, SetSecurityDescriptorControl, SetSecurityDescriptorDacl, SetSecurityDescriptorOwner, AclSizeInformation, ACL_SIZE_INFORMATION, CONTAINER_INHERIT_ACE, DACL_SECURITY_INFORMATION, INHERITED_ACE, OBJECT_INHERIT_ACE, OWNER_SECURITY_INFORMATION, PROTECTED_DACL_SECURITY_INFORMATION, TokenUser, WinBuiltinAdministratorsSid, WinLocalSystemSid, ACL, ACL_REVISION, PSECURITY_DESCRIPTOR, PSID, SECURITY_DESCRIPTOR, SE_DACL_PRESENT, SE_DACL_PROTECTED, SID_IDENTIFIER_AUTHORITY, TOKEN_QUERY, TOKEN_USER, WELL_KNOWN_SID_TYPE,
    };
    use windows_sys::Win32::Storage::FileSystem::{
        FlushFileBuffers, WriteFile, FILE_ATTRIBUTE_NORMAL, FILE_ATTRIBUTE_REPARSE_POINT, FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE, READ_CONTROL, SYNCHRONIZE, WRITE_DAC,
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
    const FILE_DIRECTORY_FILE: u32 = 0x00000001;
    const FILE_NON_DIRECTORY_FILE: u32 = 0x00000040;
    const FILE_SYNCHRONOUS_IO_NONALERT: u32 = 0x00000020;
    const FILE_OPEN_REPARSE_POINT: u32 = 0x00200000;
    const FILE_OPEN: u32 = 1;
    const FILE_CREATE: u32 = 2;
    const OBJ_CASE_INSENSITIVE: u32 = 0x00000040;
    const FILE_DISPOSITION_INFORMATION: u32 = 13;
    const ACCESS_ALLOWED_ACE_TYPE: u8 = 0;

    #[repr(C)]
    struct UnicodeString {
        length: u16,
        maximum_length: u16,
        buffer: *mut u16,
    }

    #[repr(C)]
    struct ObjectAttributes {
        length: u32,
        root_directory: HANDLE,
        object_name: *mut UnicodeString,
        attributes: u32,
        security_descriptor: *mut c_void,
        security_quality_of_service: *mut c_void,
    }

    #[repr(C)]
    struct IoStatus {
        status: usize,
        information: usize,
    }

    #[repr(C)]
    struct Disposition {
        delete_file: u8,
    }

    #[link(name = "ntdll")]
    extern "system" {
        fn NtCreateFile(handle: *mut HANDLE, access: u32, attributes: *const ObjectAttributes, io: *mut IoStatus, allocation: *const i64, attributes_file: u32, share: u32, disposition: u32, options: u32, ea: *const c_void, ea_length: u32) -> i32;
        fn NtSetInformationFile(handle: HANDLE, io: *mut IoStatus, info: *const c_void, length: u32, class: u32) -> i32;
        fn NtQueryInformationFile(handle: HANDLE, io: *mut IoStatus, info: *mut c_void, length: u32, class: u32) -> i32;
    }

    const FILE_ATTRIBUTE_TAG_INFORMATION: u32 = 35;

    #[repr(C)]
    struct AttributeTag {
        file_attributes: u32,
        reparse_tag: u32,
    }

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

    fn nt_ok(status: i32) -> bool {
        status >= 0
    }

    pub(super) fn create_dir_private(path: &Path) -> Result<(), SecretError> {
        let parent = path.parent().ok_or_else(SecretError::acl)?;
        let name = path.file_name().and_then(|text| text.to_str()).ok_or_else(SecretError::acl)?;
        let root = open_existing(parent, true)?;
        if is_reparse(root.0)? {
            return Err(SecretError::reparse());
        }
        let id = identity()?;
        let mut sd = descriptor(&id, true)?;
            match create_relative(root.0, name, true, FILE_CREATE, Some(&mut sd))? {
            Some(handle) => {
                if is_reparse(handle.0)? {
                    delete_handle(handle.0)?;
                    return Err(SecretError::reparse());
                }
                verify_handle(handle.0, &id, true)
            }
            None => Err(SecretError::acl()),
        }
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
        if let Some(existing) = create_relative(dir.0, name, false, FILE_OPEN, None)? {
            if is_reparse(existing.0)? {
                delete_handle(existing.0)?;
            } else {
                delete_handle(existing.0)?;
            }
        }
        let mut sd = descriptor(&id, false)?;
        let handle = create_relative(dir.0, name, false, FILE_CREATE, Some(&mut sd))?.ok_or_else(SecretError::acl)?;
        if is_reparse(handle.0)? {
            delete_handle(handle.0)?;
            return Err(SecretError::reparse());
        }
        verify_handle(handle.0, &id, false)?;
        write_all(handle.0, bytes)?;
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
        let handle = create_relative(dir.0, name, false, FILE_OPEN, None)?.ok_or_else(SecretError::closed)?;
        if is_reparse(handle.0)? {
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
        if let Some(handle) = create_relative(dir.0, name, false, FILE_OPEN, None)? {
            delete_handle(handle.0)?;
        }
        Ok(())
    }

    fn open_existing(path: &Path, directory: bool) -> Result<Owned, SecretError> {
        let mut wide = nt_path(path);
        let mut uni = UnicodeString {
            length: ((wide.len() - 1) * 2) as u16,
            maximum_length: (wide.len() * 2) as u16,
            buffer: wide.as_mut_ptr(),
        };
        let attributes = ObjectAttributes {
            length: std::mem::size_of::<ObjectAttributes>() as u32,
            root_directory: null_mut(),
            object_name: &mut uni,
            attributes: OBJ_CASE_INSENSITIVE,
            security_descriptor: null_mut(),
            security_quality_of_service: null_mut(),
        };
        let mut handle: HANDLE = null_mut();
        let mut io = IoStatus { status: 0, information: 0 };
        let access = if directory {
            FILE_LIST_DIRECTORY | FILE_ADD_FILE | FILE_ADD_SUBDIRECTORY | FILE_DELETE_CHILD | FILE_READ_ATTRIBUTES | FILE_WRITE_ATTRIBUTES | READ_CONTROL | WRITE_DAC | DELETE | SYNCHRONIZE
        } else {
            FILE_READ_DATA | FILE_WRITE_DATA | FILE_READ_ATTRIBUTES | READ_CONTROL | WRITE_DAC | DELETE | SYNCHRONIZE
        };
        let options = if directory { FILE_DIRECTORY_FILE } else { FILE_NON_DIRECTORY_FILE } | FILE_OPEN_REPARSE_POINT | FILE_SYNCHRONOUS_IO_NONALERT;
        let status = unsafe { NtCreateFile(&mut handle, access, &attributes, &mut io, null_mut(), FILE_ATTRIBUTE_NORMAL, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, FILE_OPEN, options, null_mut(), 0) };
        if !nt_ok(status) {
            return Err(if (status as u32) == 0xC0000034 { SecretError::closed() } else { SecretError::acl() });
        }
        Ok(Owned(handle))
    }

    fn create_relative(root: HANDLE, name: &str, directory: bool, disposition: u32, sd: Option<&mut Security>) -> Result<Option<Owned>, SecretError> {
        let mut wide: Vec<u16> = name.encode_utf16().chain(Some(0)).collect();
        let mut uni = UnicodeString {
            length: ((wide.len() - 1) * 2) as u16,
            maximum_length: (wide.len() * 2) as u16,
            buffer: wide.as_mut_ptr(),
        };
        let mut attributes = ObjectAttributes {
            length: std::mem::size_of::<ObjectAttributes>() as u32,
            root_directory: root,
            object_name: &mut uni,
            attributes: OBJ_CASE_INSENSITIVE,
            security_descriptor: null_mut(),
            security_quality_of_service: null_mut(),
        };
        if let Some(sd) = sd {
            attributes.security_descriptor = &mut sd.descriptor as *mut SECURITY_DESCRIPTOR as *mut c_void;
        }
        let mut handle: HANDLE = null_mut();
        let mut io = IoStatus { status: 0, information: 0 };
        let access = if directory {
            FILE_LIST_DIRECTORY | FILE_ADD_FILE | FILE_ADD_SUBDIRECTORY | FILE_DELETE_CHILD | FILE_READ_ATTRIBUTES | FILE_WRITE_ATTRIBUTES | READ_CONTROL | WRITE_DAC | DELETE | SYNCHRONIZE
        } else {
            FILE_READ_DATA | FILE_WRITE_DATA | FILE_APPEND_DATA | FILE_READ_ATTRIBUTES | FILE_WRITE_ATTRIBUTES | READ_CONTROL | WRITE_DAC | DELETE | SYNCHRONIZE
        };
        let options = if directory { FILE_DIRECTORY_FILE } else { FILE_NON_DIRECTORY_FILE } | FILE_OPEN_REPARSE_POINT | FILE_SYNCHRONOUS_IO_NONALERT;
        let status = unsafe { NtCreateFile(&mut handle, access, &attributes, &mut io, null_mut(), FILE_ATTRIBUTE_NORMAL, FILE_SHARE_READ | FILE_SHARE_DELETE, disposition, options, null_mut(), 0) };
        if (status as u32) == 0xC0000034 {
            return Ok(None);
        }
        if !nt_ok(status) {
            return Err(SecretError::acl());
        }
        Ok(Some(Owned(handle)))
    }

    fn is_reparse(handle: HANDLE) -> Result<bool, SecretError> {
        let mut info = AttributeTag { file_attributes: 0, reparse_tag: 0 };
        let mut io = IoStatus { status: 0, information: 0 };
        let status = unsafe { NtQueryInformationFile(handle, &mut io, &mut info as *mut _ as *mut c_void, std::mem::size_of::<AttributeTag>() as u32, FILE_ATTRIBUTE_TAG_INFORMATION) };
        if !nt_ok(status) {
            return Err(SecretError::acl());
        }
        Ok(info.file_attributes & FILE_ATTRIBUTE_REPARSE_POINT != 0)
    }

    fn delete_handle(handle: HANDLE) -> Result<(), SecretError> {
        let info = Disposition { delete_file: 1 };
        let mut io = IoStatus { status: 0, information: 0 };
        let status = unsafe { NtSetInformationFile(handle, &mut io, &info as *const _ as *const c_void, std::mem::size_of::<Disposition>() as u32, FILE_DISPOSITION_INFORMATION) };
        if !nt_ok(status) {
            return Err(SecretError::acl());
        }
        Ok(())
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

    struct Security {
        descriptor: SECURITY_DESCRIPTOR,
        _acl: Box<AclBuf>,
    }

    fn descriptor(id: &Identity, directory: bool) -> Result<Security, SecretError> {
        let mut acl = Box::new(AclBuf { bytes: [0; 768] });
        let acl_ptr = acl.bytes.as_mut_ptr() as *mut ACL;
        if unsafe { InitializeAcl(acl_ptr, acl.bytes.len() as u32, ACL_REVISION) } == 0 {
            return Err(SecretError::acl());
        }
        let flags = if directory { OBJECT_INHERIT_ACE | CONTAINER_INHERIT_ACE } else { 0 };
        for sid in [&id.user, &id.system, &id.admins] {
            if unsafe { AddAccessAllowedAceEx(acl_ptr, ACL_REVISION, flags, FILE_ALL_ACCESS, sid.as_ptr() as PSID) } == 0 {
                return Err(SecretError::acl());
            }
        }
        let mut descriptor = unsafe { std::mem::zeroed::<SECURITY_DESCRIPTOR>() };
        let sd_ptr = &mut descriptor as *mut SECURITY_DESCRIPTOR as PSECURITY_DESCRIPTOR;
        if unsafe { InitializeSecurityDescriptor(sd_ptr, 1) } == 0 {
            return Err(SecretError::acl());
        }
        if unsafe { SetSecurityDescriptorOwner(sd_ptr, id.user.as_ptr() as PSID, 0) } == 0 {
            return Err(SecretError::owner());
        }
        if unsafe { SetSecurityDescriptorDacl(sd_ptr, 1, acl_ptr, 0) } == 0 {
            return Err(SecretError::acl());
        }
        if unsafe { SetSecurityDescriptorControl(sd_ptr, SE_DACL_PROTECTED, SE_DACL_PROTECTED) } == 0 {
            return Err(SecretError::acl());
        }
        Ok(Security { descriptor, _acl: acl })
    }

    fn apply_private(handle: HANDLE, id: &Identity, directory: bool) -> Result<(), SecretError> {
        let mut sd = descriptor(id, directory)?;
        let acl = sd._acl.bytes.as_mut_ptr() as *mut ACL;
        let code = unsafe {
            SetSecurityInfo(handle, SE_FILE_OBJECT, OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION, id.user.as_ptr() as PSID, null_mut(), acl, null_mut())
        };
        if code != ERROR_SUCCESS {
            return Err(SecretError::acl());
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
        if owner.is_null() || unsafe { EqualSid(owner, id.user.as_ptr() as PSID) } == 0 {
            return Err(SecretError::owner());
        }
        let mut control = 0u16;
        let mut revision = 0u32;
        if unsafe { GetSecurityDescriptorControl(sd, &mut control, &mut revision) } == 0 {
            return Err(SecretError::acl());
        }
        if control & SE_DACL_PRESENT == 0 || control & SE_DACL_PROTECTED == 0 || dacl.is_null() {
            return Err(SecretError::acl());
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
                return Err(SecretError::acl());
            }
            let sid = unsafe { (ace as *mut u8).add(std::mem::size_of::<AceHeader>() + 4) as PSID };
            let allowed = [&id.user, &id.system, &id.admins];
            if !allowed.iter().any(|want| unsafe { EqualSid(sid, want.as_ptr() as PSID) } != 0) {
                return Err(SecretError::acl());
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

    fn nt_path(path: &Path) -> Vec<u16> {
        let raw: Vec<u16> = path.as_os_str().encode_wide().collect();
        let mut out = Vec::with_capacity(raw.len() + 5);
        out.extend(['\\' as u16, '?' as u16, '?' as u16, '\\' as u16]);
        if raw.len() >= 4 && raw[0] == '\\' as u16 && raw[1] == '\\' as u16 && raw[2] == '?' as u16 && raw[3] == '\\' as u16 {
            out.extend_from_slice(&raw[4..]);
        } else {
            out.extend(raw);
        }
        out.push(0);
        out
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
