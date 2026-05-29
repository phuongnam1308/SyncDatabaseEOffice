// src/meeting-sync2/mappers/MeetingMapper.js
/**
 * Maps a raw row from the legacy query to the canonical meeting object.
 * Reuses the fieldMapping defined in the original sync-meeting config.
 */
const { tableMappings } = require('../config');
const mapping = tableMappings.meeting;

function mapRow(row) {
  const obj = {};
  // Direct field mapping (functions may be defined in mapping.fieldMapping)
  for (const [field, mapper] of Object.entries(mapping.fieldMapping || {})) {
    if (typeof mapper === 'function') {
      obj[field] = mapper(row);
    } else {
      // If mapper is a string, copy the property directly
      obj[field] = row[mapper];
    }
  }
  // Add defaults and generated values
  obj.id = mapping.defaultValues.id();
  obj.created_at = mapping.defaultValues.created_at(row);
  obj.updated_at = mapping.defaultValues.updated_at(row);
  // Ensure required fields exist
  obj.title = mapping.defaultValues.title(row);
  obj.meeting_date = mapping.defaultValues.meeting_date(row);
  obj.meeting_time = mapping.defaultValues.meeting_time(row);
  obj.meeting_mode = mapping.defaultValues.meeting_mode(row);
  obj.meeting_state = mapping.defaultValues.meeting_state(row);
  // Add any other defaults not covered above
  for (const [key, val] of Object.entries(mapping.defaultValues)) {
    if (typeof val !== 'function' && !(key in obj)) {
      obj[key] = val;
    }
  }
  return obj;
}

module.exports = { mapRow };
