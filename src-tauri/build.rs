use std::{env, path::PathBuf};

fn main() {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("manifest directory"));
    let env_path = manifest_dir.join("..").join(".env");
    println!("cargo:rerun-if-changed={}", env_path.display());

    let _ = dotenvy::from_path(&env_path);
    for key in [
        "TMDB_BEARER_TOKEN",
        "OMDB_API_KEY",
        "SUPABASE_URL",
        "SUPABASE_ANON_KEY",
    ] {
        if let Ok(value) = env::var(key) {
            println!("cargo:rustc-env={key}={value}");
        }
    }

    tauri_build::build();
}
