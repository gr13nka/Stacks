//! Draws a fixture "photo": a white-bordered card in the session's colour with
//! the running index in big block digits, so a human can read capture order
//! straight off the deck and tell sessions apart at a glance.

use image::codecs::jpeg::JpegEncoder;
use image::{Rgb, RgbImage};

const LANDSCAPE: (u32, u32) = (600, 400);
const PORTRAIT: (u32, u32) = (400, 600);
const BORDER: u32 = 24;
const JPEG_QUALITY: u8 = 75;

/// Each glyph cell becomes a SCALE×SCALE block; 3×5 cells → 36×60 px digits.
const SCALE: u32 = 12;
const GLYPH_W: u32 = 3;
const GLYPH_H: u32 = 5;

/// 3×5 block digits, one row per byte, most significant bit = left column.
const GLYPHS: [[u8; 5]; 10] = [
    [0b111, 0b101, 0b101, 0b101, 0b111], // 0
    [0b010, 0b110, 0b010, 0b010, 0b111], // 1
    [0b111, 0b001, 0b111, 0b100, 0b111], // 2
    [0b111, 0b001, 0b111, 0b001, 0b111], // 3
    [0b101, 0b101, 0b111, 0b001, 0b001], // 4
    [0b111, 0b100, 0b111, 0b001, 0b111], // 5
    [0b111, 0b100, 0b111, 0b101, 0b111], // 6
    [0b111, 0b001, 0b001, 0b001, 0b001], // 7
    [0b111, 0b101, 0b111, 0b101, 0b111], // 8
    [0b111, 0b101, 0b111, 0b001, 0b111], // 9
];

/// One distinct mid-tone per session, chosen to stay apart from each other and
/// from the app's mint ground. Index 0 (decoys) is a flat grey.
const PALETTE: [[u8; 3]; 13] = [
    [0xbb, 0xbb, 0xbb],
    [0xe0, 0x7a, 0x5f], // terracotta
    [0x3d, 0x40, 0x5b], // slate
    [0x81, 0xb2, 0x9a], // sage
    [0xf2, 0xcc, 0x8f], // sand
    [0x6d, 0x59, 0x7a], // plum
    [0x45, 0x7b, 0x9d], // steel blue
    [0xe9, 0xc4, 0x6a], // mustard
    [0x2a, 0x9d, 0x8f], // teal
    [0xb5, 0x65, 0x76], // rose
    [0x58, 0x81, 0x57], // moss
    [0xf4, 0xa2, 0x61], // orange
    [0x8d, 0x99, 0xae], // grey-blue
];

pub fn fill_for(session: Option<usize>) -> [u8; 3] {
    PALETTE[session.map_or(0, |s| s % PALETTE.len())]
}

/// Renders the card and returns encoded JPEG bytes (baseline, quality 75).
pub fn jpeg(index: u32, fill: [u8; 3], portrait: bool) -> Vec<u8> {
    let (w, h) = if portrait { PORTRAIT } else { LANDSCAPE };
    let mut img = RgbImage::from_pixel(w, h, Rgb([255, 255, 255]));
    fill_rect(&mut img, BORDER, BORDER, w - 2 * BORDER, h - 2 * BORDER, fill);
    draw_number(&mut img, index, ink_for(fill));

    let mut out = Vec::new();
    img.write_with_encoder(JpegEncoder::new_with_quality(&mut out, JPEG_QUALITY))
        .expect("encoding an in-memory RGB image cannot fail");
    out
}

fn ink_for(fill: [u8; 3]) -> [u8; 3] {
    let luma = 0.2126 * f64::from(fill[0]) + 0.7152 * f64::from(fill[1]) + 0.0722 * f64::from(fill[2]);
    if luma < 110.0 {
        [255, 255, 255]
    } else {
        [0x20, 0x20, 0x20]
    }
}

fn fill_rect(img: &mut RgbImage, x: u32, y: u32, w: u32, h: u32, colour: [u8; 3]) {
    for py in y..y + h {
        for px in x..x + w {
            img.put_pixel(px, py, Rgb(colour));
        }
    }
}

fn draw_number(img: &mut RgbImage, number: u32, ink: [u8; 3]) {
    let digits: Vec<usize> = number.to_string().bytes().map(|b| usize::from(b - b'0')).collect();
    let advance = (GLYPH_W + 1) * SCALE;
    let text_w = digits.len() as u32 * advance - SCALE;
    let text_h = GLYPH_H * SCALE;
    let x0 = (img.width() - text_w) / 2;
    let y0 = (img.height() - text_h) / 2;

    for (i, &digit) in digits.iter().enumerate() {
        let gx = x0 + i as u32 * advance;
        for (row, bits) in GLYPHS[digit].iter().enumerate() {
            for col in 0..GLYPH_W {
                if bits & (0b100 >> col) != 0 {
                    fill_rect(img, gx + col * SCALE, y0 + row as u32 * SCALE, SCALE, SCALE, ink);
                }
            }
        }
    }
}
