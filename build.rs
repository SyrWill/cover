// Puts the icon and the name into Cover.exe (Explorer, taskbar, Alt+Tab).
fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        let mut res = winresource::WindowsResource::new();
        res.set_icon("launcher/icon.ico");
        res.set("ProductName", "Cover");
        res.set("FileDescription", "Cover");
        res.set("OriginalFilename", "Cover.exe");
        res.compile().expect("could not add the icon to the exe");
    }
}
