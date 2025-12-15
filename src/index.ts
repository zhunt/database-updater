import { createPool } from './db';
import { parseCsv } from './csvParser';
import { serialize } from 'php-serialize';
import path from 'path';


function convertJsonToPhpSerialized(jsonString: string): string {
    try {
        // Parse the JSON string into a JavaScript object
        const jsonObject = JSON.parse(jsonString);

        // Serialize the JavaScript object into PHP's serialized format
        return serialize(jsonObject);
    } catch (error) {
        console.error('Error converting JSON to PHP serialized format:', error);
        return '';
    }
}

const MAIN = async () => {
    const pool = createPool();
    const csvFilePath = path.join(__dirname, '../test-sheet-1.csv');

    try {
        console.log(`Reading CSV file from ${csvFilePath}...`);
        const columns = await parseCsv(csvFilePath);

        if (columns.length === 0) {
            console.log('No data found in CSV.');
            return;
        }

        console.log(`Found ${columns.length} rows. Processing...`);

        for (const row of columns) {
            const title = row['Title'];
            if (!title) {
                console.warn('Skipping row without "Title":', row);
                continue;
            }

            console.log(`Processing Title: "${title}"`);

            // Extract Opening Times
            /*
            const openingTimes = {
                Monday: row['Open_Time_Monday'] || '',
                Tuesday: row['Open_Time_Tuesday'] || '',
                Wednesday: row['Open_Time_Wednesday'] || '',
                Thursday: row['Open_Time_Thursday'] || '',
                Friday: row['Open_Time_Friday'] || '',
                Saturday: row['Open_Time_Saturday'] || '',
                Sunday: row['Open_Time_Sunday'] || ''
            };
*/

            const openingTimes = {
                "monday": {
                    "enable": "enable",
                    "start": {
                        "0": "00:00"
                    },
                    "close": {
                        "0": "22:00"
                    }
                },
                "tuesday": {
                    "enable": "enable",
                    "start": {
                        "0": "00:00"
                    },
                    "close": {
                        "0": "22:00"
                    }
                },
                "wednesday": {
                    "enable": "enable",
                    "start": {
                        "0": "00:00"
                    },
                    "close": {
                        "0": "22:00"
                    }
                },
                "thursday": {
                    "enable": "enable",
                    "start": {
                        "0": "00:00"
                    },
                    "close": {
                        "0": "22:00"
                    }
                },
                "friday": {
                    "enable": "enable",
                    "start": {
                        "0": "00:00"
                    },
                    "close": {
                        "0": "22:00"
                    }
                },
                "saturday": {
                    "enable": "enable",
                    "start": {
                        "0": "00:00"
                    },
                    "close": {
                        "0": "22:00"
                    }
                },
                "sunday": {
                    "enable": "enable",
                    "start": {
                        "0": "00:00"
                    },
                    "close": {
                        "0": "22:00"
                    }
                }

            };


            let metaValue = JSON.stringify(openingTimes);
            metaValue = convertJsonToPhpSerialized(metaValue);

            console.log(`  -> Meta Value: ${metaValue}`);

            // 1. Look up the ID in npu_posts
            const [postRows] = await pool.query<any[]>(
                'SELECT ID FROM npu_posts WHERE post_title = ? LIMIT 1',
                [title]
            );

            if (postRows.length === 0) {
                console.log(`  -> No post found for title "${title}". Skipping.`);
                continue;
            }

            const postId = postRows[0].ID;
            console.log(`  -> Found ID: ${postId}`);

            // 2. Look up in test_npu_postmeta
            const [metaRows] = await pool.query<any[]>(
                "SELECT meta_id FROM test_npu_postmeta WHERE post_id = ? AND meta_key = '_bdbh'",
                [postId]
            );

            if (metaRows.length > 0) {
                // Update existing
                console.log(`  -> Meta found. Updating...`);
                await pool.query(
                    "UPDATE test_npu_postmeta SET meta_value = ? WHERE post_id = ? AND meta_key = '_bdbh'",
                    [metaValue, postId]
                );
                console.log('  -> Update OK.');
            } else {
                // Insert new
                console.log(`  -> Meta not found. Inserting...`);
                await pool.query(
                    "INSERT INTO test_npu_postmeta (post_id, meta_key, meta_value) VALUES (?, '_bdbh', ?)",
                    [postId, metaValue]
                );
                console.log('  -> Insert OK.');
            }
        }

    } catch (error) {
        console.error('An error occurred:', error);
    } finally {
        await pool.end();
    }
};

MAIN();