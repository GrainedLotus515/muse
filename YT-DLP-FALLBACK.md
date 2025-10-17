# yt-dlp Fallback Implementation

## Overview

This implementation adds a robust fallback mechanism using `yt-dlp` when `ytdl-core` fails to parse YouTube's player scripts. This solves the common "Could not parse n transform function" error.

## How It Works

### Flow Diagram

```
User requests video
       ↓
Try ytdl-core first (faster)
       ↓
   Success? → Continue playing
       ↓ No
   Is it a YouTube player error?
       ↓ Yes
   Try yt-dlp fallback
       ↓
   Success? → Continue playing
       ↓ No
   Both failed → Show error
```

### Error Detection

The system automatically detects YouTube player parsing errors by checking if the error message contains:
- `transform`
- `player`
- `decipher`
- `signature`
- `status code`

When detected, it automatically switches to yt-dlp.

## Components

### 1. YtDlpService (`src/services/yt-dlp.ts`)

A TypeScript wrapper around the yt-dlp CLI tool with:

**Methods:**
- `getInfo(url)` - Fetches video metadata and available formats
- `getBestAudioFormat(info)` - Selects optimal audio format for Discord
- `getStreamUrl(url)` - Gets direct stream URL
- `isAvailable()` - Checks if yt-dlp is installed

**Features:**
- Comprehensive error handling with custom `YtDlpError` class
- Detailed debug logging for troubleshooting
- Smart format selection (prefers opus/webm for Discord)
- Livestream support
- 30-second timeout for operations

### 2. Modified Player (`src/services/player.ts`)

**Changes:**
- Imports `YtDlpService` and `YtDlpError`
- Adds `ytDlpService` instance to the Player class
- Enhanced `getStream()` method with try-catch fallback logic
- Comprehensive logging at each step

## Logging

The implementation provides detailed logs prefixed with:
- `[ytdl-core]` - ytdl-core operations
- `[yt-dlp]` - yt-dlp operations
- `[Player]` - General player operations

### Example Log Output

```
[ytdl-core] Attempting to fetch video info...
[ytdl-core] Error occurred: Could not parse n transform function
[ytdl-core] Detected YouTube player parsing error, attempting yt-dlp fallback...
[yt-dlp] Starting fallback...
[yt-dlp] Fetching info for: https://youtube.com/watch?v=...
[yt-dlp] Successfully fetched info in 1250ms
[yt-dlp] Title: Example Video
[yt-dlp] Duration: 180s
[yt-dlp] Formats available: 23
[yt-dlp] Is live: false
[yt-dlp] Selecting best audio format from 23 available formats
[yt-dlp] Selected opus format: 251 (128 kbps)
[yt-dlp] Successfully retrieved stream URL
[yt-dlp] Not caching video
```

## Error Handling

### Error Types

1. **YouTube Player Errors** - Automatically triggers yt-dlp fallback
2. **Network Errors** - Retries with reconnection logic in ffmpeg
3. **Format Selection Errors** - Falls back to next best format
4. **Both Methods Failed** - Returns comprehensive error message

### Error Messages

When both methods fail, you'll see:
```
Failed to fetch video stream. 
ytdl-core error: Could not parse n transform function. 
yt-dlp error: Video unavailable
```

## Requirements

### System Requirements
- `yt-dlp` must be installed and in PATH

### Installation

**Linux/macOS:**
```bash
# Using pip
pip install yt-dlp

# Or using package manager
sudo apt install yt-dlp  # Debian/Ubuntu
brew install yt-dlp      # macOS
```

**Check Installation:**
```bash
yt-dlp --version
```

### Verifying in Code

The service can check availability:
```typescript
const ytdlp = new YtDlpService();
const available = await ytdlp.isAvailable();
console.log(`yt-dlp available: ${available}`);
```

## Performance Considerations

### Speed
- **ytdl-core**: ~500-1000ms (faster, tries first)
- **yt-dlp**: ~1000-2000ms (slower, used as fallback)

### Caching
Videos under 30 minutes are cached to disk (excluding livestreams and when seeking).

### Format Selection Priority
1. Opus codec in WebM container @ 48kHz (best for Discord)
2. Highest bitrate audio-only format
3. Fallback to any audio format

## Troubleshooting

### yt-dlp Not Found

**Error:** `spawn yt-dlp ENOENT`

**Solution:**
```bash
which yt-dlp  # Check if installed
pip install --upgrade yt-dlp  # Install/update
```

### Both Methods Failing

**Possible Causes:**
1. Video is geo-restricted
2. Video is private or deleted
3. Network connectivity issues
4. YouTube API changes (update yt-dlp)

**Solutions:**
```bash
# Update yt-dlp
pip install --upgrade yt-dlp

# Test manually
yt-dlp --get-url --format bestaudio "VIDEO_URL"

# Check with authentication (if needed)
yt-dlp --cookies-from-browser firefox "VIDEO_URL"
```

### High Memory Usage

The buffer is set to 10MB. For very long videos, consider:
- Adjusting `maxBuffer` in `yt-dlp.ts:61`
- Enabling streaming mode

### Timeout Errors

Default timeout is 30 seconds. Adjust in `yt-dlp.ts:64`:
```typescript
timeout: 30000, // Increase if needed
```

## Monitoring

### Health Checks

Monitor the logs for patterns:
- Frequent yt-dlp fallbacks → Update @distube/ytdl-core
- All yt-dlp failures → Check yt-dlp version
- Intermittent failures → Network issues

### Metrics to Track

1. **Fallback Rate**: How often yt-dlp is used
2. **Failure Rate**: Both methods failing
3. **Average Response Time**: Per method
4. **Cache Hit Rate**: Cached vs fresh downloads

## Future Improvements

### Potential Enhancements

1. **Cookie Authentication**: Add YouTube cookies for premium/restricted content
2. **Retry Logic**: Automatic retries with exponential backoff
3. **Format Caching**: Cache format info to reduce API calls
4. **Multiple Fallbacks**: Add ytdl-core-discord or youtube-dl as tertiary fallback
5. **Metrics Dashboard**: Track success/failure rates
6. **Rate Limiting**: Implement request throttling to avoid bans

### Code Example for Cookies

```typescript
const info = await ytdl.getInfo(song.url, {
  requestOptions: {
    headers: {
      cookie: process.env.YOUTUBE_COOKIE || '',
    },
  },
});
```

## Testing

### Manual Testing

Test with a video:
```bash
# Start the bot
npm start

# In Discord, try playing a video
!play https://youtube.com/watch?v=dQw4w9WgXcQ
```

### Check Logs

Monitor logs to see which method was used:
```bash
# Look for these patterns
grep -i "ytdl-core" logs.txt
grep -i "yt-dlp" logs.txt
```

### Test Fallback Directly

```bash
# Force ytdl-core to fail (use invalid video ID)
# Should see yt-dlp fallback in logs
```

## Summary

This implementation provides:
- ✅ Automatic fallback when ytdl-core fails
- ✅ Comprehensive error handling and logging
- ✅ Smart format selection for Discord
- ✅ Support for both regular videos and livestreams
- ✅ Caching for frequently played videos
- ✅ Detailed debug information for troubleshooting
- ✅ Type-safe TypeScript implementation
- ✅ No breaking changes to existing functionality

The bot will now be much more resilient to YouTube's frequent player script changes!
