#!/bin/bash
# Database setup script for PartnerIQ

# Variables
DB_HOST=${DB_HOST:-localhost}
DB_USER=${DB_USER:-root}
DB_PASSWORD=${DB_PASSWORD:-9133477833Ab@}
DB_NAME=${DB_NAME:-partner_db}

# Create the database, then let TypeORM own the schema.
mysql -h $DB_HOST -u $DB_USER -p$DB_PASSWORD << EOF
CREATE DATABASE IF NOT EXISTS $DB_NAME;
EOF

npm run migration:run

echo "Database setup complete!"
