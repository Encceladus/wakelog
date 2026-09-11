'use strict';

const TABLE = [
  { cmd: ['helm'], sub: ['uninstall', 'delete'], level: 1, key: 'k8s-delete' },
  { cmd: ['helm'], sub: ['upgrade', 'install', 'rollback'], level: 2, key: 'k8s-write' },
  { cmd: ['helm'], level: 4 },

  { cmd: ['pulumi'], sub: ['destroy'], level: 1, key: 'tf-destroy' },
  { cmd: ['pulumi'], sub: ['up'], level: 1, key: 'tf-apply' },
  { cmd: ['pulumi'], level: 4 },
  { cmd: ['vagrant'], sub: ['destroy'], level: 1, key: 'tf-destroy' },
  { cmd: ['ansible-playbook', 'ansible'], level: 2, key: 'config-apply' },

  { cmd: ['flyctl', 'fly'], sub: ['deploy'], level: 2, key: 'deploy-prod' },
  { cmd: ['railway'], sub: ['up'], level: 2, key: 'deploy-prod' },
  { cmd: ['vercel', 'netlify'], re: /--prod/, level: 2, key: 'deploy-prod' },
  { cmd: ['vercel', 'netlify'], level: 4 },

  { cmd: ['heroku'], re: /pg:reset|pg:drop/, level: 1, key: 'sql-destructive' },
  { cmd: ['supabase'], re: /\bdb\s+reset\b/, level: 1, key: 'sql-destructive' },
  { cmd: ['prisma'], re: /migrate\s+reset|--accept-data-loss/, level: 1, key: 'sql-destructive' },
  { cmd: ['prisma'], re: /migrate\s+(deploy|dev)|db\s+push/, level: 2, key: 'db-migrate' },
  { cmd: ['alembic'], sub: ['downgrade'], level: 1, key: 'sql-destructive' },
  { cmd: ['alembic'], sub: ['upgrade'], level: 2, key: 'db-migrate' },
  { cmd: ['rails', 'rake'], re: /db:(drop|reset)/, level: 1, key: 'sql-destructive' },
  { cmd: ['rails', 'rake'], re: /db:migrate/, level: 2, key: 'db-migrate' },
  { cmd: ['mix'], re: /ecto\.(drop|reset)/, level: 1, key: 'sql-destructive' },
  { cmd: ['django-admin', 'manage.py'], sub: ['flush'], level: 1, key: 'sql-destructive' },
  { cmd: ['django-admin', 'manage.py'], sub: ['migrate'], level: 2, key: 'db-migrate' },
  { cmd: ['influx'], sub: ['delete'], level: 1, key: 'sql-destructive' },

  { cmd: ['poetry', 'gem', 'hex'], sub: ['publish', 'push'], level: 1, key: 'publish' },
  { cmd: ['brew'], sub: ['uninstall', 'remove'], level: 2, key: 'pkg-remove' },
  { cmd: ['apt', 'apt-get', 'dnf', 'yum', 'pacman', 'snap', 'zypper'],
    sub: ['remove', 'purge', 'autoremove', 'uninstall', '-R'], level: 2, key: 'pkg-remove' },
  { cmd: ['pip', 'pip3'], sub: ['uninstall'], level: 2, key: 'pkg-remove' },

  { cmd: ['crontab'], flags: ['r'], level: 1, key: 'crontab-clear' },

  { cmd: ['iptables', 'ip6tables', 'nft'], re: /\s-F\b|flush/, level: 1, key: 'firewall-flush' },
  { cmd: ['ufw'], sub: ['reset', 'disable'], level: 1, key: 'firewall-flush' },
  { cmd: ['firewall-cmd'], re: /--(reload|complete-reload|panic-on)/, level: 2, key: 'firewall-change' },

  { cmd: ['passwd', 'chpasswd'], level: 1, key: 'account-change' },
  { cmd: ['userdel', 'groupdel', 'deluser', 'delgroup'], level: 1, key: 'account-delete' },
  { cmd: ['usermod', 'chattr', 'setfacl', 'visudo', 'chsh'], level: 1, key: 'account-change' },

  { cmd: ['nvm', 'asdf', 'rustup', 'pyenv', 'rbenv', 'sdk'],
    sub: ['uninstall', 'remove'], level: 2, key: 'pkg-remove' },
  { cmd: ['killall', 'pkill'], level: 2, key: 'service' },

  { cmd: ['update-grub', 'grub-mkconfig', 'grub-install', 'mkinitcpio', 'dracut', 'efibootmgr'],
    level: 1, key: 'boot-config' },
  { cmd: ['sysctl'], flags: ['-w', '--write'], level: 2, key: 'system-config' },
  { cmd: ['timedatectl', 'hostnamectl', 'localectl'], re: /\sset-/, level: 2, key: 'system-config' },
  { cmd: ['systemctl'], sub: ['isolate', 'mask', 'set-default'], level: 1, key: 'system-config' },
  { cmd: ['swapoff', 'rmmod'], level: 2, key: 'kernel-module' },
  { cmd: ['modprobe'], flags: ['-r', '--remove'], level: 2, key: 'kernel-module' },
  { cmd: ['loginctl'], re: /terminate|kill/, level: 2, key: 'session-kill' },
  { cmd: ['wg-quick', 'tailscale', 'nmcli'], sub: ['down', 'logout', 'disconnect'],
    level: 2, key: 'network-down' },
  { cmd: ['podman', 'docker'], re: /system\s+reset/, level: 1, key: 'docker-prune' },

  { cmd: ['dd'], level: 1, key: 'dd-write' },
  { cmd: ['mkfs', 'mkfs.ext4', 'mkfs.xfs', 'mkswap', 'fdisk', 'parted'], level: 1, key: 'mkfs' },
  { cmd: ['truncate'], re: /-s\s*0/, level: 1, key: 'truncate-file' },

  { cmd: ['ssh-keygen'], level: 1, key: 'keygen' },
  { cmd: ['gpg'], re: /--delete-secret-keys|--delete-keys/, level: 1, key: 'key-delete' },

  { cmd: ['rsync'], re: /--delete/, level: 1, key: 'rsync-delete' },
  { cmd: ['rsync', 'scp'], level: 2, key: 'cloud-write' },

  { cmd: ['stripe', 'sendgrid', 'twilio', 'mailgun'], level: 1, key: 'external-effect' },
];

function matches(rule, ctx) {
  if (!rule.cmd.includes(ctx.name)) return false;
  if (rule.sub && !rule.sub.some((s) => ctx.argv.includes(s))) return false;
  if (rule.flags && !rule.flags.some((f) => ctx.flags.has(f))) return false;
  if (rule.re && !rule.re.test(ctx.raw)) return false;
  return true;
}

function lookup(ctx) {
  for (const rule of TABLE) {
    if (matches(rule, ctx)) {
      return { level: rule.level, reason: rule.key || null, tag: rule.key || 'table' };
    }
  }
  return null;
}

module.exports = { lookup, TABLE };
