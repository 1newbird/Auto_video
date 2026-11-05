"""Conservative, reference-backed repairs for provider word-SRT fragments."""
from copy import deepcopy
import hashlib
import re


def normalized(text):
    return ''.join(re.findall(r'[A-Za-z0-9\u3400-\u9fff]', text)).lower()


def normalize_groups(groups, reference):
    """Keep sentence boundaries; merge only adjacent, reference-confirmed spans.

    SRT has display intervals, not guaranteed distinct spoken words. Never
    deduplicate Chinese repetitions or infer repairs from timing alone.
    """
    groups = deepcopy(groups)
    reference = normalized(re.sub(r'```[^\n]*\n[\s\S]*?```', '', reference))
    changes, unresolved = [], []

    def candidates(group):
        i = 0
        while i < len(group):
            token = normalized(group[i]['text'])
            j = i + 1
            if re.fullmatch(r'[a-z0-9]{2,}', token):
                while (j < len(group) and normalized(group[j]['text']) == token
                       and group[j]['startSeconds'] - group[j-1]['endSeconds'] <= .08
                       and not re.search(r'[。！？!?；;]', group[j-1]['text'])):
                    j += 1
            if j > i + 1:
                yield i, j, 'repeated-token'
                i = j
                continue
            if i and re.fullmatch(r'[a-z]', token):
                prev = normalized(group[i-1]['text'])
                if (re.fullmatch(r'[a-z]{2,}', prev) and prev.endswith(token)
                    and group[i]['startSeconds'] - group[i-1]['endSeconds'] <= .08
                    and not re.search(r'[。！？!?；;]', group[i-1]['text'])):
                    yield i-1, i+1, 'english-tail'
            i += 1

    def confirmed(gi, start, end):
        group = groups[gi]
        left = normalized(''.join(p['text'] for g in groups[:gi] for p in g)
                          + ''.join(p['text'] for p in group[:start]))
        right = normalized(''.join(p['text'] for p in group[end:])
                           + ''.join(p['text'] for g in groups[gi+1:] for p in g))
        before = normalized(''.join(p['text'] for p in group[start:end]))
        after = normalized(group[start]['text'])
        # Both sides must identify one local manuscript context. A real repeat
        # in that context, missing context, or ambiguous match is left intact.
        for width in (16, 12, 8, 6, 4):
            a, b = left[-width:], right[:width]
            if len(a) < 4 or len(b) < 4:
                continue
            if a + before + b in reference:
                return False
            needle = a + after + b
            if reference.count(needle) == 1:
                return True
        return False

    # A neighbouring repeated date/number may obscure context until repaired.
    while True:
        changed = False
        for gi, group in enumerate(groups):
            for start, end, kind in reversed(list(candidates(group))):
                if not confirmed(gi, start, end):
                    continue
                parts = deepcopy(group[start:end])
                merged = dict(parts[0], endSeconds=parts[-1]['endSeconds'])
                # Preserve a terminal punctuation mark present only on the last
                # fragment, but don't append punctuation a second time.
                suffix = re.search(r'[^A-Za-z0-9\u3400-\u9fff]*$', parts[-1]['text'])[0]
                if suffix:
                    merged['text'] = re.sub(r'[^A-Za-z0-9\u3400-\u9fff]*$', '', merged['text']) + suffix
                changes.append({'segment': f's{gi+1:03d}', 'kind': kind,
                                'before': ''.join(p['text'] for p in parts), 'after': merged['text'],
                                'startSeconds': merged['startSeconds'], 'endSeconds': merged['endSeconds'],
                                'fragments': parts, 'evidence': 'unique-manuscript-context'})
                group[start:end] = [merged]
                changed = True
        if not changed:
            break
    for gi, group in enumerate(groups):
        for start, end, kind in candidates(group):
            unresolved.append({'segment': f's{gi+1:03d}', 'kind': kind,
                               'text': ''.join(p['text'] for p in group[start:end]),
                               'startSeconds': group[start]['startSeconds'],
                               'reason': '原稿未唯一确认需合并，保留原文'})
    return groups, {'version': 1, 'referenceSha256': hashlib.sha256(reference.encode()).hexdigest(),
                    'changes': changes, 'unresolved': unresolved}


def can_reuse_original_plan(plan_hash, source_hash, timeline):
    """Permit only this import's proven before -> after text change.

    Grouping happens before normalization; segment IDs and intervals are stable.
    A different input/hash must still fail the usual plan compatibility guard.
    """
    report = (timeline or {}).get('subtitleNormalization', {})
    return bool(report.get('changes') and plan_hash == report.get('sourceHashBefore')
                and source_hash == report.get('sourceHashAfter'))
