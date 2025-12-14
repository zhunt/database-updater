import { createPool } from './db';
import { parseCsv } from './csvParser';
import path from 'path';

const MAIN = async () => {
    const pool = createPool();
    const csvFilePath = path.join(__dirname, '../data.csv');
    const tableName = process.env.DB_TABLE_NAME || 'my_table';

    try {
        console.log(`Reading CSV file from ${csvFilePath}...`);
        const data = await parseCsv(csvFilePath);

        if (data.length === 0) {
            console.log('No data found in CSV.');
            return;
        }

        console.log(`Found ${data.length} rows. preparing to insert...`);

        // Get headers from the first row
        const headers = Object.keys(data[0]);
        const columns = headers.join(', ');

        // Prepare bulk insert
        // Note: appropriate escaping and validation is recommended for production
        const sql = `INSERT INTO ${tableName} (${columns}) VALUES ?`;

        const values = data.map(row => headers.map(header => row[header]));

        const [result] = await pool.query(sql, [values]);
        console.log('Insert successful:', result);

    } catch (error) {
        console.error('An error occurred:', error);
    } finally {
        await pool.end();
    }
};

MAIN();
