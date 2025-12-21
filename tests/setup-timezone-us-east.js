// Set timezone to US Eastern (west of UTC)
// This catches bugs where UTC-parsed dates shift to previous day with local getters
process.env.TZ = 'America/New_York';
