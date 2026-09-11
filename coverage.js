'use strict';
// Zestaw kontrolny: komendy, które MUSZĄ trafić na poziom 1, i takie, które nie mogą.
// Metryka to fałszywe negatywy (przepuszczone groźne), nie „ile reguł pasuje".

const { classify } = require('../lib/classify');

const MUST_BE_L1 = `userdel -r deploy
passwd -d root
lvremove /dev/vg0/lv0
zfs destroy tank/data@snap
btrfs subvolume delete /mnt/sub
iptables -F
ufw --force reset
vault kv destroy -mount=secret app
vault lease revoke -prefix auth/
etcdctl del /config --prefix
consul kv delete -recurse app/
clickhouse-client -q "TRUNCATE TABLE events"
mongorestore --drop --db acme
argocd app delete api
flux uninstall
istioctl uninstall --purge
terragrunt destroy
doctl droplet delete web-1
gsutil rm -r gs://bucket/dir
s3cmd del s3://bucket/key
rclone sync ./local remote:bucket --delete-excluded
restic forget --prune
borg delete ::archive
certbot revoke --cert-name acme.dev
chattr -i /etc/passwd
dotnet nuget push pkg.nupkg
deno publish
bun publish
cargo yank --vers 1.0.0
npm dist-tag rm pkg latest
bazel clean --expunge
journalctl --vacuum-time=1d
git lfs prune
gh cache delete --all
gh api -X DELETE /repos/acme/api/issues/1
terraform state rm aws_instance.web
kubectl drain node-1 --ignore-daemonsets
cockroach sql -e "DROP DATABASE app"
snowsql -q "DROP WAREHOUSE compute_wh"
wrangler d1 execute db --command "DROP TABLE t"
dokku apps:destroy myapp
rabbitmqctl purge_queue jobs
dbt run-operation drop_old_tables
temporal workflow terminate -w wf1
zpool destroy tank
vgremove vg0
wipefs -a /dev/sdc
virsh undefine vm1 --remove-all-storage
lxc delete web-1 --force
systemctl isolate rescue.target
podman system reset
update-grub
efibootmgr -B -b 0001
cryptsetup luksErase /dev/sdb
nvme format /dev/nvme0n1
op item delete "API key"
step ca revoke --serial 123
kafka-topics --delete --topic events
airflow dags delete etl_daily
bq rm -r -f project:dataset
aws lambda delete-function --function-name f
aws dynamodb delete-table --table-name t
gcloud sql instances delete prod-db
curl -X DELETE https://api.acme.dev/users/1
shutdown -h now
reboot`.split('\n');

const MUST_BE_QUIET = `node scripts/delete-old.js
fd -e ts
delta a b
bat README.md
semgrep --config auto
trivy image acme/api
cosign verify acme/api
gitleaks detect
changesets version
release-please release-pr
bazel build //...
just build
mise install
k6 run script.js
playwright test
systemctl status nginx
npm ci
npm test
cargo build
gh pr view 4
gh api /user
terraform plan
kubectl get pods
docker ps
git status
git log --oneline
pytest tests/
make build
rm -rf node_modules
ls -la
k9s
circleci config validate
systemd-analyze`.split('\n');

const missed = MUST_BE_L1.filter((c) => classify(c).level !== 1);
const noisy = MUST_BE_QUIET.filter((c) => classify(c).level <= 2);

const recall = Math.round(((MUST_BE_L1.length - missed.length) / MUST_BE_L1.length) * 100);
const quiet = Math.round(((MUST_BE_QUIET.length - noisy.length) / MUST_BE_QUIET.length) * 100);

console.log(`\nrecall na groźnych:   ${recall}%  (przepuszczone: ${missed.length}/${MUST_BE_L1.length})`);
console.log(`cisza na zwykłych:    ${quiet}%  (fałszywe alarmy: ${noisy.length}/${MUST_BE_QUIET.length})\n`);
if (missed.length) {
  console.log('przepuszczone:');
  for (const c of missed) console.log(`  L${classify(c).level}  ${c}`);
}
if (noisy.length) {
  console.log('\nfałszywe alarmy:');
  for (const c of noisy) console.log(`  L${classify(c).level}  ${c}`);
}
