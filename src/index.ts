import { createPool } from './db';
import { parseCsv } from './csvParser';
import { serialize } from 'php-serialize';
import path from 'path';
import { log } from 'console';


function convertStringToJSON(input: string): any {
  try {
    // Step 1: Replace blocks that start and end with single quotes and don't contain any quotes inside
    const step1 = input.replace(/'([^'"]*?)'/g, '"$1"');

    // Step 2: Leave blocks with double quotes and single quotes inside as-is (no action needed)

    // Step 3: Parse the corrected string into a JSON object
    const jsonObject = JSON.parse(step1);

    return jsonObject;
  } catch (error: any) {
    console.error("Error converting string to JSON:", error.message);
    return null;
  }
}

// Helper function to convert 12-hour time to 24-hour format
function to24HourFormat(time: string): string {
    const [_, hour, minute = "00", period] = time.match(/(\d{1,2})(?::(\d{2}))?([AP]M)?/) || [];
    let hour24 = parseInt(hour, 10);

    if (period === "PM" && hour24 !== 12) {
        hour24 += 12;
    } else if (period === "AM" && hour24 === 12) {
        hour24 = 0;
    }

    return `${hour24.toString().padStart(2, "0")}:${minute}`;
}


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

function processOpeningTimes(row: Record<string, string>): Record<string, string> {
    const days = [
        { key: 'Open_Time_Monday', label: 'monday' },
        { key: 'Open_Time_Tuesday', label: 'tuesday' },
        { key: 'Open_Time_Wednesday', label: 'wednesday' },
        { key: 'Open_Time_Thursday', label: 'thursday' },
        { key: 'Open_Time_Friday', label: 'friday' },
        { key: 'Open_Time_Saturday', label: 'saturday' },
        { key: 'Open_Time_Sunday', label: 'sunday' },
    ];

    const processedTimes: Record<string, any> = {};

    days.forEach(({ key, label }) => {
        let openingTime = row[key] || '';

        if (openingTime.includes('Closed')) {
            processedTimes[label] = { "start": { "0": "" }, "close": { "0": "" } };
        } else if (openingTime.includes('Open 24 hours')) {
            processedTimes[label] = { "enable": "enable", "remain_close": "open", "start": { "0": "12:00" }, "close": { "0": "01:00" } };
        } else {
            const regex = /(\d{1,2}(?::\d{2})?[AP]M?|\d{1,2}(?::\d{2})?)–(\d{1,2}(?::\d{2})?[AP]M?)/;
            const match = openingTime.match(regex);
            if (match) {
                let [_, startTime, endTime] = match;

                // Assume PM if no AM/PM is specified
                if (!startTime.includes('AM') && !startTime.includes('PM')) {
                    startTime += 'PM';
                }
                if (!endTime.includes('AM') && !endTime.includes('PM')) {
                    endTime += 'PM';
                }

                // Convert to 24-hour format
                const startTime24 = to24HourFormat(startTime);
                const endTime24 = to24HourFormat(endTime);

                console.log(`Start Time: ${startTime24}, End Time: ${endTime24}`);
                processedTimes[label] = { "enable": "enable", "start": { "0": startTime24 }, "close": { "0": endTime24 } }

            } else {
                console.log(`No match found for: ${openingTime}`);
            }





        }
    });

    return processedTimes;
}

function jsonToHtmlList(jsonString: string) {
    try {
        const data = JSON.parse(jsonString);
        let html = '<ul>';

        for (const [key, values] of Object.entries(data)) {
            if (Array.isArray(values)) {
                html += `<li><strong>${key}:</strong> ${values.join(', ')}</li>`;
            } else {
                console.warn(`Unexpected value type for key "${key}":`, values);
            }
        }

        html += '</ul>';
        return html;
    } catch (error) {
        console.error('Invalid JSON string:', error);
        return '<p>Error: Invalid JSON</p>';
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

            let openingTimes = processOpeningTimes(row);

            //console.log(`  -> openingTimes: ${openingTimes}`);

            let metaValue = JSON.stringify(openingTimes);
            metaValue = convertJsonToPhpSerialized(metaValue);

            // console.log(`  -> Meta Value: ${metaValue}`);

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

            // 2. Look up in npu_postmeta
            const [metaRows] = await pool.query<any[]>(
                "SELECT meta_id FROM npu_postmeta WHERE post_id = ? AND meta_key = '_bdbh'",
                [postId]
            );

            if (metaRows.length > 0) {
                // Update existing
                console.log(`  -> Meta found. Updating...`);
                await pool.query(
                    "UPDATE npu_postmeta SET meta_value = ? WHERE post_id = ? AND meta_key = '_bdbh'",
                    [metaValue, postId]
                );
                console.log('  -> Update OK.');
            } else {
                // Insert new
                console.log(`  -> Meta not found. Inserting...`);
                await pool.query(
                    "INSERT INTO npu_postmeta (post_id, meta_key, meta_value) VALUES (?, '_bdbh', ?)",
                    [postId, metaValue]
                );
                console.log('  -> Insert OK.');
            }

            // Check for meal options in "about" column
            const aboutText = row['about'] || '';
            const meals: string[] = [];
            const diets: string[] = [];

            if (aboutText.includes('Serves breakfast')) meals.push('Breakfast');
            if (aboutText.includes('Serves lunch')) meals.push('Lunch');
            if (aboutText.includes('Serves dinner')) meals.push('Dinner');

            if (aboutText.includes('halal')) diets.push('Halal');
            if (aboutText.includes('vegetarian')) diets.push('Vegetarian Friendly');

            if (meals.length > 0) {
                console.log(`  -> Found meals: ${meals.join(', ')}, updating _custom-checkbox-2`);

                let mealMetaValue = JSON.stringify(meals);
                mealMetaValue = convertJsonToPhpSerialized(mealMetaValue);

                let dietsMetaValue = JSON.stringify(diets);
                dietsMetaValue = convertJsonToPhpSerialized(dietsMetaValue);

                console.log(`  -> Meal Meta Value: ${mealMetaValue}`);
                console.log(`  -> Diets Meta Value: ${dietsMetaValue}`);

                const [mealMetaRows] = await pool.query<any[]>(
                    "SELECT meta_id FROM npu_postmeta WHERE post_id = ? AND meta_key = '_custom-checkbox-2'",
                    [postId]
                );

                if (mealMetaRows.length > 0) {
                    await pool.query(
                        "UPDATE npu_postmeta SET meta_value = ? WHERE post_id = ? AND meta_key = '_custom-checkbox-2'",
                        [mealMetaValue, postId]
                    );
                    console.log('  -> Updated _custom-checkbox-2');

                } else {
                    await pool.query(
                        "INSERT INTO npu_postmeta (post_id, meta_key, meta_value) VALUES (?, '_custom-checkbox-2', ?)",
                        [postId, mealMetaValue]
                    );
                    console.log('  -> Inserted _custom-checkbox-2');
                }

                // repeat for diets
                const [dietsMetaRows] = await pool.query<any[]>(
                    "SELECT meta_id FROM npu_postmeta WHERE post_id = ? AND meta_key = '_custom-checkbox'",
                    [postId]
                );

                if (dietsMetaRows.length > 0) {
                    await pool.query(
                        "UPDATE npu_postmeta SET meta_value = ? WHERE post_id = ? AND meta_key = '_custom-checkbox'",
                        [dietsMetaValue, postId]
                    );
                    console.log('  -> Updated _custom-checkbox');

                } else {
                    await pool.query(
                        "INSERT INTO npu_postmeta (post_id, meta_key, meta_value) VALUES (?, '_custom-checkbox', ?)",
                        [postId, dietsMetaValue]
                    );
                    console.log('  -> Inserted _custom-checkbox');
                }
            }

            // add the latitude and longitude 

            const latitude: string = row['Latitude'] || '';
            const longitude: string = row['Longitude'] || '';

            // update npu_postmeta._manual_lat and npu_postmeta._manual_lng
            if (latitude) {
                const [latMetaRows] = await pool.query<any[]>(
                    "SELECT meta_id FROM npu_postmeta WHERE post_id = ? AND meta_key = '_manual_lat'",
                    [postId]
                );

                if (latMetaRows.length > 0) {
                    await pool.query(
                        "UPDATE npu_postmeta SET meta_value = ? WHERE post_id = ? AND meta_key = '_manual_lat'",
                        [latitude, postId]
                    );
                    console.log('  -> Updated _manual_lat');

                } else {
                    await pool.query(
                        "INSERT INTO npu_postmeta (post_id, meta_key, meta_value) VALUES (?, '_manual_lat', ?)",
                        [postId, latitude]
                    );
                    console.log('  -> Inserted _manual_lat');
                }
            }

            if (longitude) {
                // repeat for longitude
                const [longMetaRows] = await pool.query<any[]>(
                    "SELECT meta_id FROM npu_postmeta WHERE post_id = ? AND meta_key = '_manual_lng'",
                    [postId]
                );

                if (longMetaRows.length > 0) {
                    await pool.query(
                        "UPDATE npu_postmeta SET meta_value = ? WHERE post_id = ? AND meta_key = '_manual_lng'",
                        [longitude, postId]
                    );
                    console.log('  -> Updated _manual_lng');

                } else {
                    await pool.query(
                        "INSERT INTO npu_postmeta (post_id, meta_key, meta_value) VALUES (?, '_manual_lng', ?)",
                        [postId, longitude]
                    );
                    console.log('  -> Inserted _manual_lng');
                }
            
            }            

            // to-do: fill in the features section, list the sub-category in bold and followed by a list of the features
            const features: string[] = [];

            let contentField = aboutText + `<hr>`; //

            // populate post_content with features
            if (aboutText) {
                const aboutTextJson = convertStringToJSON(aboutText);

                let featureListHtml = jsonToHtmlList(aboutTextJson);
            }

            // update the post table
            

        }

    } catch (error) {
        console.error('An error occurred:', error);
    } finally {
        await pool.end();
    }
};

MAIN();