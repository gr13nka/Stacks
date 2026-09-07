use std::path::Path;
use std::process::exit;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let Some(root) = args.get(1).filter(|_| args.len() == 2) else {
        eprintln!("usage: make-fixtures <out-root>   (the directory is wiped and regenerated)");
        exit(2);
    };
    match make_fixtures::generate(Path::new(root)) {
        Ok(manifest) => {
            print!("{manifest}");
            eprintln!("make-fixtures: wrote {}", Path::new(root).join("MANIFEST.txt").display());
        }
        Err(err) => {
            eprintln!("make-fixtures: {err}");
            exit(1);
        }
    }
}
