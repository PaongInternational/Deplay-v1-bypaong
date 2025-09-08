import { IncomingForm } from 'https://esm.sh/formidable@2.1.1';
import JSZip from 'https://esm.sh/jszip@3.10.1';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    try {
        const form = new IncomingForm();
        
        const [fields, files] = await new Promise((resolve, reject) => {
            form.parse(req, (err, fields, files) => {
                if (err) return reject(err);
                resolve([fields, files]);
            });
        });

        const zipFile = files.zipfile[0];
        const projectName = fields.projectName[0];
        
        if (!zipFile || !projectName) {
            return res.status(400).json({ message: 'Nama proyek dan file ZIP harus diunggah.' });
        }

        // Baca dan ekstrak file ZIP
        const zipData = await Deno.readFile(zipFile.filepath);
        const zip = await JSZip.loadAsync(zipData);
        
        // Ambil semua file dari ZIP
        const vercelFiles = await Promise.all(
            zip.file(/\.|\//).map(async (zipEntry) => ({
                file: zipEntry.name,
                data: await zipEntry.async('text'),
                encoding: 'base64',
            }))
        );

        // Deploy ke Vercel dengan API
        const vercelToken = process.env.VERCEL_TOKEN;
        if (!vercelToken) {
            return res.status(500).json({ message: 'Token Vercel tidak ditemukan.' });
        }

        const vercelResponse = await fetch('https://api.vercel.com/v13/deployments', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${vercelToken}`,
                'Content-Type': 'application/json',
                'x-vercel-action': 'create-deployment',
            },
            body: JSON.stringify({
                name: projectName,
                files: vercelFiles,
            }),
        });

        const vercelData = await vercelResponse.json();
        if (!vercelResponse.ok) {
            throw new Error(`Vercel deployment gagal: ${JSON.stringify(vercelData)}`);
        }

        const deploymentUrl = `https://${vercelData.alias[0]}`;
        
        // Simpan data ke database Supabase
        const supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_ROLE_KEY
        );

        const { error: dbError } = await supabase
            .from('projects')
            .insert({
                // Ganti dengan userId yang sesuai dari otentikasi
                user_id: 'some-user-id',
                name: projectName,
                deployment_url: deploymentUrl,
                vercel_project_id: vercelData.id,
            });

        if (dbError) {
            console.error('Gagal menyimpan ke database:', dbError);
            // Tetap kembalikan respons sukses meskipun penyimpanan DB gagal
        }

        return res.status(200).json({ message: 'Deployment berhasil!', url: deploymentUrl });

    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'Terjadi kesalahan internal.', error: err.message });
    }
}
