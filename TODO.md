# PostgreSQL Migration TODO

## [ ] 1. Update package.json
- Remove better-sqlite3
- Add pg ^8.11.5

## [ ] 2. Rewrite db.js  
- Use pg.Pool with postgresql://stocksim_user:stocksim123@localhost:5432/stocksim
- Replace prepared statements with parameterized queries
- Add connection test

## [ ] 3. Test Functions
- getUser(), createUser()
- getPortfolio(), updatePortfolio()
- All CRUD operations

## [ ] 4. Migrate Data (optional)
- sqlite3 .dump | psql stocksim

## [ ] 5. Update server.js (minimal)
- No schema changes needed

## [ ] 6. npm install && npm run dev
- Verify port 5000 works

