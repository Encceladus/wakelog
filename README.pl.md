# wakelog

[![test](https://github.com/Encceladus/wakelog/actions/workflows/test.yml/badge.svg)](https://github.com/Encceladus/wakelog/actions/workflows/test.yml)

English README: [README.md](README.md)

Po autonomicznej sesji agenta wypisuje, co zrobił nieodwracalnie — a resztę zwija w licznik.

Log chronologiczny ma 200 linii i nikt go nie czyta. Tu sortowanie idzie po odwracalności, nie po czasie: rzeczy, które git i tak cofnie, schodzą do jednej linijki.

## Instalacja

```
npx wakelog install
```

Dopisuje dwa hooki do `~/.claude/settings.json` (z backupem, nie ruszając cudzych wpisów) i tyle. Zero configu, zero konta, zero klucza API. Działa offline — klasyfikacja jest deterministyczna, model nie jest używany.

Potem `/hooks` w Claude Code, żeby przeładować.

## Jak to działa

| Hook | Rola |
| --- | --- |
| `PostToolUse` (matcher `Bash`) | dopisuje komendę do logu sesji |
| `SessionEnd` | klasyfikuje log i wypisuje podsumowanie |

Świadomie nie używa `Stop` (odpala się po każdej odpowiedzi) ani `PreToolUse` (może zablokować sesję). `SessionEnd` nie potrafi niczego zepsuć — najgorsze, co zrobi buggy wersja, to brak podsumowania.

Domyślnym językiem jest angielski. Polski przez `WAKELOG_LANG=pl` albo automatycznie, gdy locale zaczyna się od `pl`.

Stan leży w `~/.local/state/wakelog/` i kasuje się po wypisaniu raportu. To nie jest plik do edycji.

## Poziomy

1. **Nieodwracalne** — `push --force`, `git clean -fdx`, `DROP TABLE`, `terraform apply`, publikacja pakietu, zapis poza projektem, wysłanie danych na zewnątrz
2. **Odwracalne cudzym kosztem** — zwykły `push`, restart usługi, instalacja globalna, `sudo`
3. **Odwracalne lokalnie** — wszystko, co odtworzy git
4. **Bez efektu** — odczyt, build, testy

Poziomy 3 i 4 są zwinięte w licznik. Widzisz tylko 1 i 2.

Trzy reguły przekrojowe:

- Nierozwiązywalna zmienna w pozycji destrukcyjnej (`rm -rf "$DIR"`) → zawsze poziom 1. Bez zgadywania.
- Domyślny poziom to 3. Eskalacja tylko przy dopasowaniu, nigdy w drugą stronę.
- Komenda złożona klasyfikuje się po najwyższym poziomie swoich składowych — stąd własny tokenizer, nie regex.

## Inne komendy

```
wakelog explain "git clean -fdx"   # klasyfikacja jednej komendy
wakelog last                       # ostatnie podsumowanie
wakelog uninstall
```

## Czego v0 nie robi

- **Nie wykrywa „poza zakresem".** Bez pliku zakresu nie ma z czym porównać deklarowanej intencji, a zgadywanie z promptu dawałoby fałszywe alarmy.
- **Nie generuje polityk.** Podsumowanie jest tylko do czytania.
- **Nie wyjaśnia komend przed wykonaniem.** To osobny tryb, na `PreToolUse`.
- **Nie parsuje transkryptu sesji** — opiera się wyłącznie na udokumentowanym wejściu hooka, żeby nie pękać przy aktualizacjach.

## Metryka, która teraz coś znaczy

Odpal agenta na prawdziwym repo, zrób bałagan, wyjdź. Jeśli podsumowanie mówi tylko rzeczy, które `git status` daje za darmo — klasyfikacja jest za płytka. Każda komenda, którą chciałeś zobaczyć, a wpadła do poziomu 3, to brakująca reguła w `lib/classify.js`.

## Uwaga

API hooków Claude Code ewoluuje. Przed zmianami sprawdź aktualny schemat:
https://docs.claude.com/en/docs/claude-code/hooks

MIT.
