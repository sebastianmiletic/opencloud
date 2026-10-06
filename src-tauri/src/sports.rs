//! Read-only Camel integration, intentionally separate from movie providers.
use chrono::NaiveDate;
use std::{sync::OnceLock, time::Duration};
use url::Url;

static CLIENT: OnceLock<Result<reqwest::Client, String>> = OnceLock::new();
const MAX_BODY_BYTES: usize = 3 * 1024 * 1024;

fn valid_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 80
        && value.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
}

fn upstream(resource: &str, date: Option<&str>, match_id: Option<&str>, stream_name: Option<&str>) -> Result<Url, String> {
    let (route, parameter, value) = match resource {
        "schedule" => {
            let value = date.ok_or("missing match date")?;
            let parsed = NaiveDate::parse_from_str(value, "%Y%m%d").map_err(|_| "invalid match date")?;
            if value.len() != 8 || !value.bytes().all(|b| b.is_ascii_digit()) || parsed.format("%Y%m%d").to_string() != value {
                return Err("invalid match date".into());
            }
            ("home_match", "day", value)
        }
        "streams" => {
            let value = match_id.filter(|value| valid_identifier(value)).ok_or("invalid match identifier")?;
            ("football/stream", "matchId", value)
        }
        "token" => {
            let value = stream_name.filter(|value| valid_identifier(value)).ok_or("invalid stream identifier")?;
            ("token", "streamName", value)
        }
        _ => return Err("unsupported sports resource".into()),
    };
    let mut url = Url::parse(&format!("https://api.cameltv.live/camel-service/ee/sports_live/{route}"))
        .map_err(|error| error.to_string())?;
    url.query_pairs_mut().append_pair(parameter, value);
    Ok(url)
}

#[tauri::command]
pub async fn fetch_sports(resource: String, date: Option<String>, match_id: Option<String>, stream_name: Option<String>) -> Result<serde_json::Value, String> {
    let url = upstream(&resource, date.as_deref(), match_id.as_deref(), stream_name.as_deref())?;
    let client = CLIENT.get_or_init(|| reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::none())
        .user_agent("OpenCloud/3 sports")
        .build().map_err(|error| error.to_string())).clone()?;
    let mut response = client.get(url)
        .header(reqwest::header::ACCEPT, "application/json")
        .header(reqwest::header::ACCEPT_LANGUAGE, "en")
        .send().await.map_err(|_| "Camel could not be reached. Try refreshing.")?
        .error_for_status().map_err(|_| "Camel could not be reached. Try refreshing.")?;
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "Camel returned an incomplete response.")? {
        if body.len() + chunk.len() > MAX_BODY_BYTES {
            return Err("Camel returned an oversized response.".into());
        }
        body.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&body).map_err(|_| "Camel returned an invalid response.".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sports_requests_are_read_only_and_have_fixed_destinations() {
        let url = upstream("schedule", Some("20261006"), None, None).unwrap();
        assert_eq!(url.host_str(), Some("api.cameltv.live"));
        assert_eq!(url.path(), "/camel-service/ee/sports_live/home_match");
        assert_eq!(url.query(), Some("day=20261006"));
        assert!(upstream("streams", None, Some("jw2r09hk8384rz8"), None).is_ok());
        assert!(upstream("token", None, None, Some("sd-test_Stream")).is_ok());
    }

    #[test]
    fn sports_requests_reject_paths_invalid_dates_and_arbitrary_urls() {
        for resource in ["https://evil.test", "../account", "favorite", ""] {
            assert!(upstream(resource, Some("20261006"), Some("match"), Some("stream")).is_err());
        }
        for date in ["20260230", "20261301", "20261006&url=https://evil.test", "2026-10-06", ""] {
            assert!(upstream("schedule", Some(date), None, None).is_err());
        }
        for identifier in ["", "../secret", "http://localhost", "match?token=1", "name%2Ffoo"] {
            assert!(upstream("streams", None, Some(identifier), None).is_err());
            assert!(upstream("token", None, None, Some(identifier)).is_err());
        }
    }
}
