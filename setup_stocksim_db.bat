@echo off
set PGPASSWORD=postgres
echo Setting up stocksim database...
psql -U postgres -h localhost -p 5432 -c "CREATE DATABASE stocksim;"
psql -U postgres -h localhost -p 5432 -c "CREATE USER stocksim_user WITH PASSWORD 'stocksim123';"
psql -U postgres -h localhost -p 5432 -c "GRANT ALL PRIVILEGES ON DATABASE stocksim TO stocksim_user;"
psql -U postgres -d stocksim -f stocksim_schema.sql
echo Database setup complete!
echo Connection: postgresql://stocksim_user:stocksim123@localhost:5432/stocksim
pause
