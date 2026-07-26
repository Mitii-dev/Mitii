# Reservation System Documentation

This is a reservation system with database integration that demonstrates fixes for known issues.

## Issues Fixed

1. **Missing `src/db.js` module** - The application was crashing on startup due to a missing database module
2. **Logic bug in `reserveStock` function** - Fixed comparison operator from `>` to `>=` to properly handle exact stock reservation cases
3. **Negative quantity validation** - Added proper validation to reject negative quantities with clear error message

## Features

- Express.js based web server
- Stock reservation logic with proper boundary handling
- Database integration mock module
- RESTful API endpoints for order reservations
- Comprehensive test coverage

## Running the Application

```bash
npm start
```

The application will start on port 3000.

## Testing

The system includes comprehensive tests that verify:
- Database module functionality
- Stock reservation logic (including edge cases)
- Exact stock match scenarios that were previously failing
- Negative quantity validation

## Files

- `src/index.js` - Main application entry point
- `src/db.js` - Database integration module  
- `src/routes/orders.js` - Order reservation routes