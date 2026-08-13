use serde::Serialize;

const POINTS_PER_MM: f64 = 72.0 / 25.4;
const MIN_PAPER_MM: f64 = 10.0;
const MAX_PAPER_MM: f64 = 5_000.0;

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrintPageProfile {
    width_mm: f64,
    height_mm: f64,
    width_points: f64,
    height_points: f64,
}

#[tauri::command]
pub fn prepare_print_page(width_mm: f64, height_mm: f64) -> Result<PrintPageProfile, String> {
    let profile = print_page_profile(width_mm, height_mm)?;

    #[cfg(target_os = "macos")]
    configure_macos_print_info(profile);

    Ok(profile)
}

fn print_page_profile(width_mm: f64, height_mm: f64) -> Result<PrintPageProfile, String> {
    if !width_mm.is_finite()
        || !height_mm.is_finite()
        || !(MIN_PAPER_MM..=MAX_PAPER_MM).contains(&width_mm)
        || !(MIN_PAPER_MM..=MAX_PAPER_MM).contains(&height_mm)
    {
        return Err("The requested PDF paper size is invalid.".into());
    }
    Ok(PrintPageProfile {
        width_mm,
        height_mm,
        width_points: width_mm * POINTS_PER_MM,
        height_points: height_mm * POINTS_PER_MM,
    })
}

fn portrait_paper_points(profile: PrintPageProfile) -> (f64, f64) {
    if profile.width_mm >= profile.height_mm {
        (profile.height_points, profile.width_points)
    } else {
        (profile.width_points, profile.height_points)
    }
}

#[cfg(target_os = "macos")]
fn configure_macos_print_info(profile: PrintPageProfile) {
    use objc2_app_kit::{NSPaperOrientation, NSPrintInfo};
    use objc2_foundation::{NSSize, NSString};

    let print_info = NSPrintInfo::sharedPrintInfo();
    let landscape = profile.width_mm >= profile.height_mm;
    let (portrait_width, portrait_height) = portrait_paper_points(profile);
    let paper_name = NSString::from_str(&format!(
        "LUMCAD {:.0}x{:.0} mm",
        profile.width_mm, profile.height_mm
    ));
    print_info.setPaperName(Some(&paper_name));
    print_info.setPaperSize(NSSize::new(portrait_width, portrait_height));
    print_info.setOrientation(if landscape {
        NSPaperOrientation::Landscape
    } else {
        NSPaperOrientation::Portrait
    });
    print_info.setTopMargin(0.0);
    print_info.setRightMargin(0.0);
    print_info.setBottomMargin(0.0);
    print_info.setLeftMargin(0.0);
    print_info.setHorizontallyCentered(false);
    print_info.setVerticallyCentered(false);
    NSPrintInfo::setSharedPrintInfo(&print_info);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_a0_landscape_from_millimetres_to_native_points() {
        let profile = print_page_profile(1189.0, 841.0).unwrap();
        assert!((profile.width_points - 3370.393700787402).abs() < 1e-9);
        assert!((profile.height_points - 2383.937007874016).abs() < 1e-9);
    }

    #[test]
    fn rejects_unbounded_native_paper_sizes() {
        assert!(print_page_profile(0.0, 841.0).is_err());
        assert!(print_page_profile(f64::NAN, 841.0).is_err());
        assert!(print_page_profile(10_000.0, 841.0).is_err());
    }

    #[test]
    fn normalizes_native_paper_dimensions_before_applying_landscape_orientation() {
        let landscape = print_page_profile(1189.0, 841.0).unwrap();
        let portrait = print_page_profile(841.0, 1189.0).unwrap();
        let expected = (portrait.width_points, portrait.height_points);
        assert_eq!(portrait_paper_points(landscape), expected);
        assert_eq!(portrait_paper_points(portrait), expected);
    }

    #[test]
    fn preserves_every_iso_a_series_dimension_in_both_orientations() {
        for (short_side, long_side) in [
            (210.0, 297.0),
            (297.0, 420.0),
            (420.0, 594.0),
            (594.0, 841.0),
            (841.0, 1189.0),
        ] {
            let landscape = print_page_profile(long_side, short_side).unwrap();
            let portrait = print_page_profile(short_side, long_side).unwrap();
            let expected_portrait_points = (
                short_side * POINTS_PER_MM,
                long_side * POINTS_PER_MM,
            );

            assert_eq!(portrait_paper_points(landscape), expected_portrait_points);
            assert_eq!(portrait_paper_points(portrait), expected_portrait_points);
            assert!((landscape.width_mm - long_side).abs() < f64::EPSILON);
            assert!((landscape.height_mm - short_side).abs() < f64::EPSILON);
            assert!((portrait.width_mm - short_side).abs() < f64::EPSILON);
            assert!((portrait.height_mm - long_side).abs() < f64::EPSILON);
        }
    }
}
