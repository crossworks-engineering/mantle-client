//! The one native alert the shell shows, and the OS version check that may
//! need it. Both must run on the main thread.

/// A modal alert with an OK button. Also written to stderr, so a run from a
/// terminal says the same thing.
pub fn alert(title: &str, message: &str) {
    eprintln!("[mantle-desktop] {title}: {message}");
    #[cfg(target_os = "macos")]
    {
        use objc2::MainThreadMarker;
        use objc2_app_kit::NSAlert;
        use objc2_foundation::NSString;
        let Some(mtm) = MainThreadMarker::new() else {
            return;
        };
        let alert = NSAlert::new(mtm);
        alert.setMessageText(&NSString::from_str(title));
        alert.setInformativeText(&NSString::from_str(message));
        alert.runModal();
    }
    #[cfg(target_os = "linux")]
    {
        use gtk::prelude::*;
        let dialog = gtk::MessageDialog::new(
            None::<&gtk::Window>,
            gtk::DialogFlags::MODAL,
            gtk::MessageType::Warning,
            gtk::ButtonsType::Ok,
            message,
        );
        dialog.set_title(title);
        dialog.run();
        dialog.close();
    }
}

/// The macOS major version, read the way wry reads it to decide whether a
/// per-window data store exists (NSProcessInfo.operatingSystemVersion).
#[cfg(target_os = "macos")]
pub fn macos_major() -> isize {
    objc2_foundation::NSProcessInfo::processInfo()
        .operatingSystemVersion()
        .majorVersion
}
